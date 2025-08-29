const BASES = [
    "/assets/images/index/project-capture/",  // 절대 경로
    "./assets/images/index/project-capture/"  // 상대 경로 백업
];
const EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
const MAX_COUNT = 50;

const $captureDialog = document.getElementById("captureDialog");
const $captureList = $captureDialog.querySelector(".capture-list");
const $btnClose = $captureDialog.querySelector(".capture-close");
const $thumbnails = document.getElementById('box-project').querySelectorAll('div.thumbnail');


const showDialogNow = () => {
    try {
        $captureDialog.showModal();
    } catch {
        $captureDialog.setAttribute("open", "");
    }
};

const closeDialog = () => {
    if ($captureDialog.open) $captureDialog.close();
    $captureList.innerHTML = "";
};

const renderImages = (srcList) => {
    $captureList.innerHTML = "";
    for (const src of srcList) {
        const img = document.createElement("img");
        img.src = src;
        $captureList.appendChild(img);
    }
};

const loadUrl = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => reject(src);
    img.src = src;
});

const loadProjectImageAtIndex = (project, i) => {
    const tried = [];
    let chain = Promise.reject();                 // 첫 시도 트리거
    BASES.forEach((base) => {
        EXTENSIONS.forEach((ext) => {
            const url = `${base}${project}/${project}-${i}.${ext}`;
            tried.push(url);
            chain = chain.catch(() => loadUrl(url));  // 실패하면 다음 URL 시도
        });
    });
    return chain.then((okUrl) => ({ok: okUrl, tried}))
        .catch(() => ({ok: null, tried}));
};

const loadProjectImages = (project, max = MAX_COUNT) => {
    const found = [];
    const triedAll = [];
    let chain = Promise.resolve();
    for (let i = 1; i <= max; i++) {
        chain = chain
            .then(() => loadProjectImageAtIndex(project, i))
            .then(({ok, tried}) => {
                triedAll.push(...tried);
                if (!ok) return Promise.reject(new Error("STOP"));
                found.push(ok);
            });
    }
    return chain.then(() => ({found, triedAll}))
        .catch(() => ({found, triedAll}));
};

$thumbnails.forEach(($thumbnail) => {
    $thumbnail.addEventListener("click", (e) => {
        const project = $thumbnail.dataset.project;

        renderImages([]);
        showDialogNow();

        loadProjectImages(project).then(({found}) => {
            renderImages(found);
        });
    });
});

$btnClose.addEventListener("click", closeDialog);
$captureDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialog();
});
$captureDialog.addEventListener("click", (e) => {
    if (e.target === $captureDialog) closeDialog();
});
