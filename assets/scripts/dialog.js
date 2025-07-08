const projectCaptureCount = {
    'omok': 3,
    'weather': 6,
    'avs': 7,
    'vr': 7,
    'taza': 10,
    'restaurant': 5,
    'ems': 11
};

const projectTitle = {
    'omok': '오목',
    'weather': '동네 날씨 예보',
    'avs': 'AVS',
    'vr': 'VR - 도심속 퍼즐 찾기',
    'taza': 'Taza - 택시 호출',
    'restaurant': '식당 찾기',
    'ems': 'EMS - 운동 일지 관리 시스템'
};

const $boxProject = document.getElementById('box-project');
const $thumbnails = $boxProject.querySelectorAll('.thumbnail');

const $dialog = document.getElementById('dialog-project');
const $btnClose = $dialog.querySelector(':scope > .button-close');
const $title = $dialog.querySelector(':scope > .title');
const $blurBackground = document.getElementById('dialog-blur-area');

const updateProjectDialog = (projectName) => {
    $title.innerText = projectTitle[projectName];

    const captureCount = projectCaptureCount[projectName];

    const $captureSlide = $dialog.querySelector(':scope > .capture-slide');
    $captureSlide.querySelectorAll(':scope > .capture').forEach($capture => {
        $capture.remove();
    });
    const $controller = $captureSlide.querySelector(':scope > .controller');
    for (let index = 1; index <= captureCount; index++) {
        const img = document.createElement('img');
        img.classList.add('capture');

        if (index === 1) {
            img.classList.add('visible');
        }

        img.src = `./assets/images/index/project-capture/${projectName}/${projectName}-${index}.png`;
        img.alt = `capture${index}`;
        img.setAttribute('data-value', index);

        $controller.before(img);
    }

    $controller.querySelectorAll(':scope > .label').forEach($label => {
        $label.remove();
    });
    for (let index = 1; index <= captureCount; index++) {
        const $label = document.createElement('label');
        $label.classList.add('label');

        const $input = document.createElement('input');
        $input.classList.add('radio');
        $input.type = 'radio';
        $input.name = 'step';
        $input.value = index;
        if (index === 1) {
            $input.checked = true;
        }

        const $span = document.createElement('span');
        $span.classList.add('knob');

        $label.appendChild($input);
        $label.appendChild($span);

        $controller.append($label);
    }


    const $radioButtons = $dialog.querySelectorAll('.controller .radio');
    const $captures = $dialog.querySelectorAll('.capture');
    // radio 버튼 클릭 시 이미지 변경
    $radioButtons.forEach(($radioButton) => {
        $radioButton.addEventListener('change', (event) => {
            $captures.forEach(($capture) => {
                $capture.classList.remove('visible');
            });

            const selectedValue = event.target.value;
            $captureSlide.querySelector(`:scope > .capture[data-value="${selectedValue}"]`).classList.add('visible');
        });
    });
}

const showProjectDialog = (projectName) => {
    document.body.style.overflow = 'hidden';

    updateProjectDialog(projectName);

    $dialog.classList.add('visible');
    $blurBackground.classList.add('visible');
};

const hideProjectDialog = () => {
    document.body.style.overflow = 'auto';

    $dialog.classList.remove('visible');
    $blurBackground.classList.remove('visible');
}

$btnClose.addEventListener('click', hideProjectDialog);
$blurBackground.addEventListener('click', hideProjectDialog);

$thumbnails.forEach(($thumbnail) => {
    $thumbnail.addEventListener('click', (e) => {
        const projectName = e.currentTarget.dataset.project;
        showProjectDialog(projectName);
    });
});