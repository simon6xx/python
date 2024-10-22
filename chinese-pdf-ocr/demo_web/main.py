import os
import sys
import base64
import json

import cv2
import numpy as np
from flask import Flask, render_template, request, make_response, jsonify

# self-defined modules to be added to PYTHONPATH
project_root = os.path.dirname(os.path.abspath(__file__)) + '/..'
sys.path.append(project_root)
from pdfocr import PdfOcrTool

# end of self-defined module list

app = Flask(__name__)
ocr = PdfOcrTool()


@app.route('/', methods=['GET', 'POST'])
def index():
    # get the image of the current pdf page
    # perform ocr on the image and return the result
    if request.method == 'POST':
        datafromjs = request.form['page_img']
        encoded_data = datafromjs.split(',')[1]
        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        page_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        labeled_textbox = ocr.predict(page_img)
        response = make_response(json.dumps(labeled_textbox))
        response.headers['Content-Type'] = "application/json"
        return response
    return render_template('index.html')


@app.route('/full_ocr', methods=['POST'])
def full_ocr():
    # 获取客户端发送的图像数据
    pdf_data = request.form['pdf_data']
    all_page_imgs = json.loads(pdf_data)  # 假设前端发来的是 Base64 编码的图像数组

    # 假设 OCR 引擎返回每页的文本结果
    all_labeled_textboxes = {}

    for page_num, page_img_data in enumerate(all_page_imgs):
        # 处理 Base64 解码图像数据
        img_data = page_img_data.split(',')[1]
        nparr = np.frombuffer(base64.b64decode(img_data), np.uint8)
        page_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # 假设有 OCR 引擎调用，获取 OCR 结果
        labeled_textbox = ocr.predict(page_img)
        all_labeled_textboxes[page_num + 1] = labeled_textbox  # 将结果按页码存储

    # 定义保存路径，项目根目录下的 download 文件夹
    save_folder = os.path.join(os.getcwd(), 'download')

    # 如果文件夹不存在，则创建它
    if not os.path.exists(save_folder):
        os.makedirs(save_folder)

    # 定义文件保存路径
    save_path = os.path.join(save_folder, 'ocr_results.json')

    # 保存 OCR 结果为 JSON 文件
    try:
        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(all_labeled_textboxes, f, ensure_ascii=False, indent=4)
        print(f"OCR results successfully saved to {save_path}")
    except Exception as e:
        print(f"Failed to save OCR results: {e}")
        return jsonify({"error": "Failed to save OCR results."}), 500

    return jsonify({"message": "OCR scan completed and saved to ocr_results.json."})


@app.route('/search_ocr', methods=['GET'])
def search_ocr():
    search_text = request.args.get('search_text', '')

    # 定义 OCR 结果文件路径
    ocr_results_path = os.path.join(os.getcwd(), 'download', 'ocr_results.json')

    if not os.path.exists(ocr_results_path):
        return jsonify({"error": "OCR results file not found."}), 404

    # 读取 OCR 结果文件
    with open(ocr_results_path, 'r', encoding='utf-8') as f:
        ocr_results = json.load(f)

    # 存储找到匹配文本的页码
    search_results = []

    # 遍历 OCR 结果并查找关键字
    for page_num, page_data in ocr_results.items():
        ocr_text = ' '.join([entry[1] for entry in page_data.values()])  # 获取该页的所有 OCR 文本
        if search_text.lower() in ocr_text.lower():  # 不区分大小写搜索
            search_results.append(page_num)

    return jsonify({"results": search_results})


if __name__ == '__main__':
    app.run()
