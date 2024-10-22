var pdfjsLib = window['pdfjs-dist/build/pdf'];

const SHORT_EDGE_MINLEN = 960;

var pdfDoc = null,
    pageNum = 1,
    pageRendering = false,
    pageNumPending = null,
    scale = 1,
    pdfCanvas = document.getElementById('pdf-layer'),
    pdfCanvasCtx = pdfCanvas.getContext('2d'),
    ocrCanvas = new fabric.Canvas('ocr-layer');

var textCopiedAlert = new BootstrapAlert({
    dismissible: true,
    fadeIn: true,
    destroyAfter: 1500
});
textCopiedAlert.setBackground('success');
textCopiedAlert.addP('<b>📋✅ OCR text copied to clipboard.</b>');

var currentOcrResults = {}; // 存储每页的OCR结果

function renderPage(num) {
    pageRendering = true;
    pdfDoc.getPage(num).then(function (page) {
        var originalViewport = page.getViewport({scale: 1});
        scale = Math.max(SHORT_EDGE_MINLEN, document.getElementById("canvas-layers").offsetWidth) / originalViewport.width;
        var scaledViewport = page.getViewport({scale: scale});
        pdfCanvas.height = scaledViewport.height;
        pdfCanvas.width = scaledViewport.width;

        var renderContext = {
            canvasContext: pdfCanvasCtx,
            viewport: scaledViewport
        };
        renderTask = page.render(renderContext);
        renderTask.promise.then(function () {
            pageRendering = false;
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
        });
    });
    document.getElementById('page_num').textContent = num;
}

function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

function onPrevPage() {
    if (pageNum <= 1) return;
    ocrCanvas.clear();
    pageNum--;
    queueRenderPage(pageNum);
    $('html,body').scrollTop(0);
}

document.getElementById('prev').addEventListener('click', onPrevPage);

function onNextPage() {
    if (pageNum >= pdfDoc.numPages) return;
    ocrCanvas.clear();
    pageNum++;
    queueRenderPage(pageNum);
    $('html,body').scrollTop(0);
}

document.getElementById('next').addEventListener('click', onNextPage);

function onDoOcr() {
    if (pageNum < 1 || pageNum > pdfDoc.numPages) return;
    var pageImg = pdfCanvas.toDataURL('image/png');
    var jqXHR = $.ajax({
        type: "POST",
        url: "/",
        async: false,
        data: {page_img: pageImg}
    });
    var labeledTextbox = JSON.parse(jqXHR.responseText);
    currentOcrResults[pageNum] = labeledTextbox;

    const ocrTextContainer = document.getElementById('ocr-text');
    ocrTextContainer.innerHTML = "";
    for (const [label, textbox] of Object.entries(labeledTextbox)) {
        ocrTextContainer.innerHTML += `${textbox[1]}<br>`;
    }

    ocrCanvas.setHeight(pdfCanvas.height);
    ocrCanvas.setWidth(pdfCanvas.width);
    ocrCanvas.clear();

    for (var [label, textbox] of Object.entries(labeledTextbox)) {
        var boundingBox = textbox[0];
        var rect = new fabric.Rect({
            left: boundingBox[0],
            top: boundingBox[1],
            width: boundingBox[2],
            height: boundingBox[3],
            fill: 'red',
            opacity: 0.3,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            hasControls: false,
            hoverCursor: 'pointer'
        });
        rect.text = textbox[1];

        rect.on('mouseup', function () {
            if (window.isSecureContext && navigator.clipboard) {
                navigator.clipboard.writeText(this.text);
            } else {
                unsecuredCopyToClipboard(this.text);
            }
            document.getElementById('alert-flex-container').appendChild(textCopiedAlert.render());
            ocrCanvas.discardActiveObject();
        });

        ocrCanvas.add(rect);
    }
}

document.getElementById('do-ocr').addEventListener('click', onDoOcr);

function unsecuredCopyToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Unable to copy to clipboard', err);
    }
    document.body.removeChild(textArea);
}

document.getElementById('file').onchange = function (event) {
    var file = event.target.files[0];
    var fileReader = new FileReader();
    fileReader.onload = function () {
        var typedarray = new Uint8Array(this.result);
        var loadingTask = pdfjsLib.getDocument(typedarray);
        loadingTask.promise.then(function (pdf) {
            pdfDoc = pdf;
            document.getElementById('page_count').textContent = pdfDoc.numPages;
            renderPage(pageNum);
        });
    }
    fileReader.readAsArrayBuffer(file);
}

$.fn.extend({
    editable: function () {
        $(this).each(function () {
            var $el = $(this),
                $edittextbox = $('<input type="text"></input>').css('min-width', $el.width()),
                submitChanges = function () {
                    if ($edittextbox.val() !== '') {
                        $el.html($edittextbox.val());
                        $el.show();
                        $el.trigger('editsubmit', [$el.html()]);
                        $(document).unbind('click', submitChanges);
                        $edittextbox.detach();
                    }
                },
                tempVal;
            $edittextbox.click(function (event) {
                event.stopPropagation();
            });

            $el.dblclick(function (e) {
                tempVal = $el.html();
                $edittextbox.val(tempVal).insertBefore(this)
                    .bind('keypress', function (e) {
                        var code = (e.keyCode ? e.keyCode : e.which);
                        if (code == 13) {
                            submitChanges();
                        }
                    }).select();
                $el.hide();
                $(document).click(submitChanges);
            });
        });
        return this;
    }
});

$('#page_num').editable().on('editsubmit', function (event, val) {
    var num = parseInt(val);
    if (!isNaN(num) && num > 0 && num <= pdfDoc.numPages) {
        if (num != pageNum) {
            ocrCanvas.clear();
            pageNum = num;
            queueRenderPage(pageNum);
            $('html,body').scrollTop(0);
        }
    } else {
        document.getElementById('page_num').textContent = pageNum;
    }
});

// 搜索功能实现并高亮显示
document.getElementById('search-btn').addEventListener('click', function () {
    const searchText = document.getElementById('search-input').value.trim();
    if (!searchText) return;

    const ocrTextContainer = document.getElementById('ocr-text');
    const textContent = ocrTextContainer.innerText;
    const regex = new RegExp(searchText, 'gi');
    const matches = [...textContent.matchAll(regex)];

    if (matches.length > 0) {
        alert(`Found ${matches.length} result(s) on page ${pageNum}`);

        // 高亮匹配的文本
        let highlightedText = textContent.replace(regex, (match) => `<span class="highlight">${match}</span>`);
        ocrTextContainer.innerHTML = highlightedText; // 更新带高亮的文本
    } else {
        alert('No results found on this page');
    }
});

document.getElementById('full-ocr').addEventListener('click', function () {
    console.log("One-click OCR started...");

    var file = document.getElementById('file').files[0];
    if (!file) {
        alert('Please upload a PDF first.');
        return;
    }

    var progressBar = document.getElementById('scan-progress');
    var progressBarInner = document.getElementById('progress-bar');
    var scanCompleteAlert = document.getElementById('scan-complete');

    progressBar.classList.remove('hidden');
    scanCompleteAlert.classList.add('hidden');

    var fileReader = new FileReader();
    fileReader.onload = function () {
        var typedarray = new Uint8Array(this.result);
        var loadingTask = pdfjsLib.getDocument(typedarray);

        loadingTask.promise.then(function (pdf) {
            console.log("PDF loaded successfully, total pages: " + pdf.numPages);
            pdfDoc = pdf;
            var totalPages = pdfDoc.numPages;
            var allPagesData = [];

            for (let i = 1; i <= totalPages; i++) {
                pdfDoc.getPage(i).then(function (page) {
                    var viewport = page.getViewport({scale: 1});
                    var canvas = document.createElement('canvas');
                    var context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    var renderContext = {
                        canvasContext: context,
                        viewport: viewport
                    };

                    page.render(renderContext).promise.then(function () {
                        console.log("Rendered page " + i);
                        allPagesData.push(canvas.toDataURL('image/png'));

                        // 更新进度条
                        let progressPercentage = (allPagesData.length / totalPages) * 100;
                        progressBarInner.style.width = progressPercentage + '%';

                        if (allPagesData.length === totalPages) {
                            console.log("All pages rendered, starting OCR...");
                            $.ajax({
                                type: "POST",
                                url: "/full_ocr",
                                data: {pdf_data: JSON.stringify(allPagesData)},
                                success: function (response) {
                                    console.log("OCR completed.");
                                    currentOcrResults = response;

                                    progressBar.classList.add('hidden');
                                    scanCompleteAlert.classList.remove('hidden');
                                },
                                error: function () {
                                    console.log("OCR failed.");
                                    progressBar.classList.add('hidden');
                                    alert('OCR scan failed. Please try again.');
                                }
                            });
                        }
                    });
                });
            }
        });
    }
    fileReader.readAsArrayBuffer(file);
});


// 全文搜索按钮
document.getElementById('search-btn-full').addEventListener('click', function () {
    const searchText = document.getElementById('search-input-full').value.trim();
    if (!searchText) {
        alert('Please enter a search term.');
        return;
    }

    // 发起请求让后端读取 OCR 文件
    $.ajax({
        type: "GET",
        url: "/search_ocr",
        data: {search_text: searchText},
        success: function (response) {
            const searchResults = response.results;
            if (searchResults.length > 0) {
                alert(`Found results on the following pages: ${searchResults.join(', ')}`);
            } else {
                alert('No results found in the entire document.');
            }
        },
        error: function () {
            alert('Error searching OCR results.');
        }
    });
});