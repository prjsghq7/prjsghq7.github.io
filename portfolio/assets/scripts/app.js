const menu=document.querySelector(".menu"),nav=document.querySelector("#nav");menu?.addEventListener("click",()=>{const o=menu.getAttribute("aria-expanded")==="true";menu.setAttribute("aria-expanded",String(!o));nav?.classList.toggle("open",!o)});nav?.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>{nav.classList.remove("open");menu?.setAttribute("aria-expanded","false")}));



/* Tech stack focus refinement */
(() => {
  const techItems = [...document.querySelectorAll(".skill-item")];

  techItems.forEach((item) => {
    item.addEventListener("click", () => {
      item.focus({ preventScroll: true });
    });
  });
})();
