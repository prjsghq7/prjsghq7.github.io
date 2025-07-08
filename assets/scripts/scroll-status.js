// scroll 상태(수치 : %) header 상위에 표출
const updateScrollStatus = () => {
    const scrollPercent = document.documentElement.scrollTop / (document.documentElement.scrollHeight - document.documentElement.clientHeight);

    const $header = document.getElementById('header');
    const $scrollStatus = $header.querySelector(':scope > .scroll-area > .scroll-status');
    $scrollStatus.style.width = scrollPercent * 100 + '%';

    const sectionColor = [
        '#FF3B30',  //intro
        '#FF9500',  //about
        '#FFCC00',  //education
        '#4CD964',  //certification
        '#5AC8FA',  //career
        '#0066cc',  //tech
        '#9B59B6'   //project

        // '#151e2a',  //intro
        // '#151e2a',  //about
        // '#151e2a',  //education
        // '#151e2a',  //certification
        // '#151e2a',  //career
        // '#151e2a',  //tech
        // '#b5b5b5'   //project

        // '#FF0000',  //intro
        // '#FFA500',  //about
        // '#FFFF00',  //education
        // '#008000',  //certification
        // '#0000FF',  //career
        // '#000080',  //tech
        // '#800080'   //project
    ];

    // visible class가 있는 section 찾기 (그 중 제일 위에 위치한 요소를 찾기위해 all X)
    const visibleSection = document.body.querySelector(':scope > #main > .section-container > .box.visible');
    if (visibleSection !== null) {
        const currentSectionIndex = visibleSection.dataset.index;
        $scrollStatus.style.background = sectionColor[currentSectionIndex];

        const sectionHeights = [];
        let totalSectionHeight = 0;
        const sections = document.body.querySelectorAll(':scope > #main > .section-container > .box');

        const gradientColors = [];
        for (let i = 0; i <= currentSectionIndex; i++) {
            const sectionHeight = sections[i].offsetHeight;
            totalSectionHeight += sectionHeight;
            sectionHeights.push(sectionHeight);
        }
        
        //누적 section 높이
        let cumulativeSectionHeight = 0;
        for (let i = 0; i < currentSectionIndex; i++) {
            cumulativeSectionHeight  += sectionHeights[i];
            gradientColors.push(`${sectionColor[i]} ${cumulativeSectionHeight / totalSectionHeight * 100}%`);
        }
        gradientColors.push(`${sectionColor[currentSectionIndex]} 100%`);

        const gradientColor = gradientColors.join(', ');
        $scrollStatus.style.background = `linear-gradient(90deg, ${gradientColor})`;
    }
};

window.addEventListener('scroll', updateScrollStatus);
window.addEventListener('DOMContentLoaded', updateScrollStatus);