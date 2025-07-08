const $keywords = document.querySelectorAll('.keyword');
let index = 1;
setInterval(() => {
    $keywords.forEach(($keyword) => {
        const keywordIndex = Number($keyword.dataset.index);
        if (keywordIndex === index) {
            $keyword.classList.add('invisible');
        } else {
            $keyword.classList.remove('invisible');
        }
    });

    index++;
    if (index >= $keywords.length) {
        index = 0;
    }

    $keywords.forEach(($keyword) => {
        const keywordIndex = Number($keyword.dataset.index);
        if (keywordIndex === index) {
            $keyword.classList.add('visible');
        } else {
            $keyword.classList.remove('visible');
        }
    });
}, 2000);