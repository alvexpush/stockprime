(function(){
  const input=document.querySelector("[data-help-search]");
  const categories=[...document.querySelectorAll("[data-category]")];
  const filters=[...document.querySelectorAll("[data-help-filter]")];
  const empty=document.querySelector("[data-help-empty]");
  let category="all";

  function applyFilter(){
    const query=input.value.trim().toLowerCase();
    let matches=0;
    categories.forEach(section=>{
      let sectionMatches=0;
      section.querySelectorAll("details").forEach(article=>{
        const visible=(!query||`${article.textContent} ${article.dataset.searchText||""}`.toLowerCase().includes(query));
        article.hidden=!visible;
        if(visible)sectionMatches+=1;
      });
      const visibleCategory=(category==="all"||section.dataset.category===category)&&sectionMatches>0;
      section.hidden=!visibleCategory;
      if(visibleCategory)matches+=sectionMatches;
    });
    empty.hidden=matches>0;
  }

  filters.forEach(button=>button.addEventListener("click",()=>{
    category=button.dataset.helpFilter;
    filters.forEach(item=>item.classList.toggle("active",item===button));
    applyFilter();
  }));
  input.addEventListener("input",applyFilter);
  document.querySelector("[data-help-search-form]").addEventListener("submit",event=>{event.preventDefault();applyFilter();document.querySelector("[data-help-articles]").scrollIntoView({behavior:"smooth",block:"start"})});
  document.querySelectorAll("[data-open-support]").forEach(button=>button.addEventListener("click",()=>document.querySelector(".support-bot-launch")?.click()));
})();
