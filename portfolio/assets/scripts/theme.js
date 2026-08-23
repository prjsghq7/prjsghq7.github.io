const THEME_KEY="portfolio-theme";
const root=document.documentElement;
const toggle=document.querySelector("#theme-toggle");
const label=toggle?.querySelector(".theme-label");

function applyTheme(theme){
  const next=theme==="dark"?"dark":"light";
  root.dataset.theme=next;

  if(toggle){
    const target=next==="dark"?"라이트":"다크";
    toggle.setAttribute("aria-label",`${target} 테마로 변경`);
    toggle.title=`${target} 테마로 변경`;
  }

  if(label){
    label.textContent=next==="dark"?"LIGHT":"DARK";
  }
}

let savedTheme=null;
try{
  savedTheme=localStorage.getItem(THEME_KEY);
}catch(error){
  savedTheme=null;
}

applyTheme(savedTheme==="dark"?"dark":"light");

toggle?.addEventListener("click",()=>{
  const next=root.dataset.theme==="dark"?"light":"dark";
  applyTheme(next);

  try{
    localStorage.setItem(THEME_KEY,next);
  }catch(error){
    // 저장이 차단된 환경에서도 현재 페이지의 테마 전환은 계속 동작한다.
  }
});
