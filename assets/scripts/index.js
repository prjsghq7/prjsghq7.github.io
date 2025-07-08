// 모바일 비율의 화면에서는 메뉴 목록이 토글 버튼 클릭시에만 표출되도록
document.getElementById('linkToggleButton').addEventListener('click', () => {
    const $header = document.getElementById('header');
    const $linkContainer = $header.querySelector(':scope > .link-container');
    const $toggleButtonIcon = $header.querySelector(':scope > .alternative-container > #linkToggleButton > .icon');

    const currentMenuShowState = $linkContainer.classList.contains('visible');
    if (currentMenuShowState) {
        $linkContainer.classList.remove('visible');
        $toggleButtonIcon.classList.remove('hiding');
    } else {
        $linkContainer.classList.add('visible');
        $toggleButtonIcon.classList.add('hiding');
    }
});

// visible class중 가장 상위에 있는 section에 해당하는 header의 link에 active class 추가
const updateActiveLink = (currentSection) => {
    const $header = document.getElementById('header');
    const allLinks = $header.querySelectorAll(':scope > .link-container > .link.internal');

    // 각 링크의 href의 값과 currentSection의 id가 같은지 비교
    allLinks.forEach(link => {
        const linkId = link.getAttribute('href').substring(1); // #을 제외한 href 값 : id
        if (linkId === currentSection.id) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}


/* 요소와 뷰포트의 가시성 교차를 관찰하기 위한 객체 IntersectionObserver 객체화 및 관찰 함수 정의 */
const ioCallback = (entries, observer) => {
    if (window.screen.width <= 480 && observer !== ioMobile) {
        return;
    }
    if (window.screen.width > 480 && observer !== ioDefault) {
        return;
    }

    entries.forEach((entry) => {
        if (entry.isIntersecting === true) {
            entry.target.classList.add('visible');
        } else {
            entry.target.classList.remove('visible');
        }
    });

    const visibleSection = document.querySelector('section.visible');
    updateActiveLink(visibleSection);
};
const ioDefault = new IntersectionObserver(ioCallback, {rootMargin: '-81px 0px 0px 0px'});
const ioMobile = new IntersectionObserver(ioCallback, {rootMargin: '-51px 0px 0px 0px'});

const $boxes = Array.from(document.body.querySelectorAll(':scope > #main > .section-container > .box'));
/* 선택한 .box 요소들을 반복하여 교차 관찰 객체에 관찰(observer)함수 호출 */
$boxes.forEach(($box) => {
    // intersectionObserver.observe($box);
    ioDefault.observe($box);
    ioMobile.observe($box);
});

const $topAnchor = document.getElementById('topAnchor');
// 스크롤이 발생하였을 때
window.addEventListener('scroll', () => {
    // 문서 기준으로 세로축으로 스크롤된 값이 50px을 초과하면
    if (document.documentElement.scrollTop > 50) {
        // $topAnchor에 visible 클래스를 추가하여 보이게 하고,
        $topAnchor.classList.add('visible');
    } else {
        // 아니면 $topAnchor에 visible 클래스를 제거하여 숨김
        $topAnchor.classList.remove('visible');
    }
});