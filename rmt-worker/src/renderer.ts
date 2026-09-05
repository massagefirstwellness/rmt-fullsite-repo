/**
 * Ported, mostly verbatim, from rmt-site-builder__7_.html's in-browser
 * generator. These were already pure string-building functions (no DOM
 * access outside applyBlockOrder, which is intentionally dropped for the
 * server-side v1 — see note below). `opts.theme` / `opts.layout` replace
 * the old builder's `state.theme` / `state.layout` globals.
 *
 * NOT ported yet: the custom-block drag/reorder system (applyBlockOrder,
 * BLOCK_LABELS, custom block templates). That was local-browser-only
 * state in the old tool; if you want it back, it needs a `page_blocks`
 * table so ordering/custom blocks persist in Supabase like everything
 * else. Flagging as a deliberate scope cut for v1, not an oversight.
 */

export type BuildOpts = { theme: string; layout: "split" | "centered" | "fullbleed" };

// Module-scoped, set once per build via setOpts() before calling any buildX()
// function below — mirrors the old browser tool's `state.theme`/`state.layout`
// globals, just scoped to one server-side render pass instead of a browser tab.
let opts: BuildOpts = { theme: "sage", layout: "split" };
export function setOpts(o: BuildOpts) {
  opts = o;
}

const esc = (s: unknown) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c as string]!)));
const slugify = (s: unknown) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const money = (cents: number | null) => (cents == null ? "" : "$" + (Number(cents) / 100).toFixed(0));
const jsonClean = (obj: unknown) => JSON.stringify(obj, (_k, v) => (v === undefined ? undefined : v));

function schemaMedicalBusiness(rmt,avg,count){
  const obj={"@context":"https://schema.org","@type":"HealthAndBeautyBusiness","name":rmt.brand_name||rmt.full_name,
    "image":rmt.photo_url||undefined,"url":rmt.domain?`https://${rmt.domain}`:undefined,"telephone":rmt.phone||undefined,
    "email":rmt.email||undefined,"address":{"@type":"PostalAddress","streetAddress":rmt.address||undefined,
    "addressLocality":rmt.city,"addressRegion":rmt.province,"postalCode":rmt.postal_code||undefined,"addressCountry":"CA"},"priceRange":"$$"};
  if(rmt.hours)obj.openingHoursSpecification=Object.entries(rmt.hours).filter(([,v])=>v&&String(v).toLowerCase()!=="closed").map(([day,h])=>({
    "@type":"OpeningHoursSpecification","dayOfWeek":({mon:"Monday",tue:"Tuesday",wed:"Wednesday",thu:"Thursday",fri:"Friday",sat:"Saturday",sun:"Sunday"})[day]||day,
    "opens":String(h).split("-")[0]?.trim(),"closes":String(h).split("-")[1]?.trim()}));
  if(avg&&count)obj.aggregateRating={"@type":"AggregateRating","ratingValue":Number(avg).toFixed(1),"reviewCount":count};
  return jsonClean(obj);
}
function schemaPerson(rmt){return jsonClean({"@context":"https://schema.org","@type":"Person","name":rmt.full_name,"jobTitle":"Registered Massage Therapist","worksFor":{"@type":"Organization","name":rmt.clinic_name||rmt.brand_name},"image":rmt.photo_url||undefined,"url":rmt.domain?`https://${rmt.domain}/about.html`:undefined,"hasCredential":rmt.credentials||undefined});}
function schemaService(rmt,s){return jsonClean({"@context":"https://schema.org","@type":"Service","name":s.name,"description":s.short_description||s.long_description,"provider":{"@type":"Person","name":rmt.full_name},"areaServed":{"@type":"City","name":rmt.city},"offers":s.price_cents?{"@type":"Offer","price":(Number(s.price_cents)/100).toFixed(2),"priceCurrency":"CAD"}:undefined});}
function schemaFAQ(faqs){if(!faqs?.length)return null;return jsonClean({"@context":"https://schema.org","@type":"FAQPage","mainEntity":faqs.map(f=>({"@type":"Question","name":f.question,"acceptedAnswer":{"@type":"Answer","text":f.answer}}))});}
function schemaBreadcrumb(rmt,items){return jsonClean({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":items.map((it,i)=>({"@type":"ListItem","position":i+1,"name":it.name,"item":`https://${rmt.domain}${it.path}`}))});}

const ICON_PATHS={
 leaf:'<path d="M4 20c8-1 14-6 16-16C10 5 4 11 4 20Z"/><path d="M4 20c3-5 7-9 12-11"/>',
 hands:'<path d="M8 13V6a2 2 0 1 1 4 0v5"/><path d="M12 12V4a2 2 0 1 1 4 0v9"/><path d="M16 12.5V7a2 2 0 1 1 4 0v9c0 3.5-2.5 6.5-6 6.5h-2c-2 0-3.3-.7-4.5-2.2L4 16c-.6-.8-.4-1.8.4-2.3.7-.4 1.6-.3 2.2.3l1.4 1.5"/>',
 heart:'<path d="M12 20.5S3.5 15 3.5 8.8C3.5 5.6 6 4 8.4 4c1.6 0 3 .8 3.6 2 .6-1.2 2-2 3.6-2 2.4 0 4.9 1.6 4.9 4.8 0 6.2-8.5 11.7-8.5 11.7Z"/>',
 clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 tag:'<path d="M12 3h6a2 2 0 0 1 2 2v6a1.5 1.5 0 0 1-.44 1.06l-8.5 8.5a1.5 1.5 0 0 1-2.12 0l-6.5-6.5a1.5 1.5 0 0 1 0-2.12l8.5-8.5A1.5 1.5 0 0 1 12 3Z"/><circle cx="15.5" cy="7.5" r="1.25" fill="currentColor" stroke="none"/>',
 check:'<path d="M4.5 12.5 9 17l10.5-11"/>',
 star:'<path d="M12 3.5l2.6 5.4 5.9.7-4.3 4.1 1.1 5.9L12 16.8l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.7Z"/>',
 quote:'<path d="M8.5 8.5c-2.2 0-4 1.9-4 4.4 0 2.4 1.6 4.1 3.7 4.1.4 2.3-1 3.9-3.2 4.5v1.5c3.7-.5 6-2.9 6-6.8V13c0-2.5-1.1-4.5-2.5-4.5Z"/><path d="M17 8.5c-2.2 0-4 1.9-4 4.4 0 2.4 1.6 4.1 3.7 4.1.4 2.3-1 3.9-3.2 4.5v1.5c3.7-.5 6-2.9 6-6.8V13c0-2.5-1.1-4.5-2.5-4.5Z"/>',
 chevron:'<path d="M6 9l6 6 6-6"/>',
 phone:'<path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8Z"/>',
 mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
 pin:'<path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
 shield:'<path d="M12 3l7 3v6c0 4.8-3 8.3-7 9-4-.7-7-4.2-7-9V6Z"/><path d="M9 12l2 2 4-4.5"/>',
 arrow:'<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'
};
function icon(name,size=24){return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]||""}</svg>`;}
function waveDivider(flip){return `<div class="wave-divider${flip?" flip":""}"><svg viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30c150 25 300 25 450 5s300-25 450-5 300 25 300 25V60H0Z" fill="currentColor"/></svg></div>`;}

/* Placeholder images from Pixabay (free to use, no attribution required).
   Swap rmt.photo_url / blog cover_image_url in Supabase to replace these. */
const DEFAULT_IMAGES={
  hero:"https://cdn.pixabay.com/photo/2017/09/06/20/35/woman-2722936_1280.jpg",
  portrait:"https://cdn.pixabay.com/photo/2014/07/11/08/54/massage-389719_1280.jpg",
  blog:"https://cdn.pixabay.com/photo/2016/08/11/02/23/massage-therapy-1584711_1280.jpg"
};
function nav(rmt,active){
  const links=[["index.html","Home","index"],["services.html","Services","services"],["conditions.html","Conditions Treated","conditions"],["about.html","About","about"],["blog/index.html","Blog","blog"],["testimonials.html","Testimonials","testimonials"],["faq.html","FAQ","faq"],["contact.html","Contact","contact"]];
  const items=links.map(([href,label,key])=>`<a href="/${href}" class="${key===active?"active":""}">${label}</a>`).join("");
  const topBar=(rmt.phone||rmt.city)?`<div class="topbar"><div class="container topbar-inner">${rmt.phone?`<a class="icon-line" href="tel:${esc(rmt.phone_tel||rmt.phone)}">${icon("phone",14)}${esc(rmt.phone)}</a>`:"<span></span>"}<span class="icon-line">${icon("pin",14)}${esc(rmt.city)}, ${esc(rmt.province)}</span></div></div>`:"";
  return `<header class="site-header">${topBar}<div class="container header-inner"><a href="/index.html" class="brand">${icon("leaf",26)}<span>${esc(rmt.brand_name||rmt.full_name)}</span></a><input type="checkbox" id="nav-toggle" class="nav-toggle"><label for="nav-toggle" class="hamburger" aria-label="Menu"><span></span><span></span><span></span></label><nav class="main-nav">${items}</nav></div></header>`;
}
function footer(rmt){
  return `<footer class="site-footer"><div class="container footer-grid"><div><h3>${icon("leaf",22)}<span>${esc(rmt.brand_name||rmt.full_name)}</span></h3><p>${esc(rmt.credentials||"")}</p><p class="icon-line">${icon("pin",16)}${esc(rmt.address||"")}${rmt.address?", ":""}${esc(rmt.city)}, ${esc(rmt.province)}</p></div><div><h4>Contact</h4>${rmt.phone?`<p class="icon-line"><a href="tel:${esc(rmt.phone_tel||rmt.phone)}">${icon("phone",16)}${esc(rmt.phone)}</a></p>`:""}${rmt.email?`<p class="icon-line"><a href="mailto:${esc(rmt.email)}">${icon("mail",16)}${esc(rmt.email)}</a></p>`:""}</div><div><h4>Quick Links</h4><a href="/services.html">Services</a><a href="/faq.html">FAQ</a><a href="/contact.html">Contact</a></div></div><div class="footer-bottom container"><p>&copy; ${new Date().getFullYear()} ${esc(rmt.brand_name||rmt.full_name)}. All Rights Reserved.</p></div></footer>`;
}
/* Reorders/hides top-level <main> sections for EVERY generated page (built-in
   top-level pages AND every per-record service/condition/blog-post page, via
   blockKey()), and injects custom blocks at their chosen slot. Custom blocks
   are wrapped in the same .section/.container built-ins use so spacing always
   matches. Applied uniformly by generate() after wrap(), for present pages and
   any future ones (new services/conditions/posts share their template's key). */
// NOTE: the old browser tool's applyBlockOrder() (custom-block drag/reorder,
// show/hide) is intentionally dropped here — it used DOMParser, which
// doesn't exist in the Workers runtime, and its state lived only in the
// browser tab. Every page below now always renders in the same built-in
// section order. If you want reorder/custom-blocks back, it needs a
// `page_blocks` table in Supabase so the config is real server-side data
// instead of browser state — happy to design that next if you want it.
function wrap({rmt,pageTitle,metaDescription,path:pagePath,bodyHtml,jsonLdBlocks=[]}){
  const canonical=rmt.domain?`https://${rmt.domain}${pagePath}`:pagePath;
  const ld=jsonLdBlocks.filter(Boolean).map(j=>`<script type="application/ld+json">${j}<\/script>`).join("\n  ");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(pageTitle)}</title><meta name="description" content="${esc(metaDescription)}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(pageTitle)}"><meta property="og:description" content="${esc(metaDescription)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(canonical)}"><meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=${getTheme(opts.theme).googleFonts}&display=swap" rel="stylesheet"><link rel="stylesheet" href="/css/style.css">${ld}</head><body>${nav(rmt,pagePath.split("/")[1]?.replace(".html","")||"index")}<div id="app-view">${bodyHtml}</div>${footer(rmt)}<script src="/js/app.js" defer><\/script></body></html>`;
}
function faqBlock(faqs){
  if(!faqs?.length)return "";
  return `<section class="section faq-section" data-bid="faq"><div class="container"><div class="section-head"><span class="icon-badge">${icon("heart",22)}</span><h2>Frequently Asked Questions</h2></div><div class="faq-list">${faqs.map((f,i)=>`<details class="faq-item"${i===0?" open":""}><summary><span>${esc(f.question)}</span>${icon("chevron",20)}</summary><p>${esc(f.answer)}</p></details>`).join("")}</div></div></section>`;
}
function booking(rmt,label="Book an Appointment"){
  const u=esc(rmt.booking_url||"/contact.html");
  return `<a href="${u}" class="btn btn-primary btn-lg" ${rmt.booking_url?'target="_blank" rel="noopener"':""}>${esc(label)}${icon("arrow",18)}</a>`;
}
function pageHero(iconName,title,subtitle,pagePath){
  const sub=subtitle?`<p>${subtitle}</p>`:"";
  const img=(DEFAULT_IMAGES.hero);
  if(opts.layout==="split"){
    return `<section class="page-hero page-hero-split" data-bid="hero"><div class="container page-hero-split-inner"><div><span class="icon-badge">${icon(iconName,26)}</span><h1>${title}</h1>${sub}</div><div class="page-hero-split-img"><img src="${esc(img)}" alt="" loading="lazy"></div></div></section>`;
  }
  if(opts.layout==="fullbleed"){
    return `<section class="page-hero page-hero-fullbleed" data-bid="hero"><img class="page-hero-fullbleed-img" src="${esc(img)}" alt="" loading="lazy"><div class="page-hero-fullbleed-overlay"></div><div class="container page-hero-fullbleed-copy"><span class="icon-badge on-dark">${icon(iconName,26)}</span><h1>${title}</h1>${sub}</div></section>`;
  }
  return `<section class="page-hero" data-bid="hero"><div class="container"><span class="icon-badge">${icon(iconName,26)}</span><h1>${title}</h1>${sub}</div></section>`;
}
function heroSection(rmt){
  const img=esc((rmt.photo_url||DEFAULT_IMAGES.hero));
  const eyebrow=`<span class="eyebrow-mark">${icon("leaf",18)} ${esc(rmt.city)}, ${esc(rmt.province)}</span>`;
  const title=`<h1>${esc(rmt.full_name)}<br>Registered Massage Therapist</h1>`;
  const desc=`<p class="hero-desc">${esc(rmt.tagline||rmt.bio_short||"")}</p>`;
  const actions=`<div class="hero-actions">${booking(rmt)}<a href="/services.html" class="btn btn-outline">View Services</a></div>`;
  const note=rmt.direct_billing?`<p class="hero-note">${icon("check",18)} Direct billing available for most major insurance providers</p>`:"";
  if(opts.layout==="centered"){
    return `<section class="hero hero-centered" data-bid="hero"><div class="container hero-centered-copy">${eyebrow}${title}${desc}${actions}${note}</div><div class="hero-banner"><img src="${img}" alt="${esc(rmt.full_name)}, Registered Massage Therapist in ${esc(rmt.city)}" loading="eager"></div>${waveDivider()}</section>`;
  }
  if(opts.layout==="fullbleed"){
    return `<section class="hero hero-fullbleed" data-bid="hero"><img class="hero-fullbleed-img" src="${img}" alt="${esc(rmt.full_name)}, Registered Massage Therapist in ${esc(rmt.city)}" loading="eager"><div class="hero-fullbleed-overlay"></div><div class="container hero-fullbleed-copy">${eyebrow}${title}${desc}${actions}${note}</div>${waveDivider()}</section>`;
  }
  return `<section class="hero" data-bid="hero"><div class="container hero-inner"><div class="hero-copy">${eyebrow}${title}${desc}${actions}${note}</div><div class="hero-art"><img src="${img}" alt="${esc(rmt.full_name)}, Registered Massage Therapist in ${esc(rmt.city)}" loading="eager"><span class="hero-icon a">${icon("hands",26)}</span><span class="hero-icon b">${icon("leaf",22)}</span></div></div>${waveDivider()}</section>`;
}
function buildIndex(d){
 const {rmt,services,testimonials,faqs}=d,featured=services.slice(0,3);
 const avg=testimonials.length?testimonials.reduce((s,t)=>s+Number(t.rating||0),0)/testimonials.length:null;
 const homeFaq=faqs.filter(f=>f.page==="home"||f.page==="general");
 const serviceIcons=["hands","leaf","heart","clock","shield","star"];
 const body=`<main>${heroSection(rmt)}<section class="section" data-bid="intro"><div class="container"><div class="section-head center"><span class="icon-badge">${icon("hands",22)}</span><h2>What Massage Therapy Can Help With</h2><p class="lede">${esc(rmt.full_name)} treats a range of conditions in ${esc(rmt.city)}, from chronic pain to sports injuries to everyday stress. Every treatment plan is tailored to what you're actually dealing with.</p></div><div class="grid-3">${featured.map((s,i)=>`<div class="card"><span class="card-icon">${icon(serviceIcons[i%serviceIcons.length],26)}</span><h3>${esc(s.name)}</h3><p>${esc(s.short_description||"")}</p><a class="card-link" href="/services/${esc(s.slug)}.html">Learn more ${icon("arrow",16)}</a></div>`).join("")}</div><p class="center-cta"><a href="/services.html" class="btn btn-outline">View All Services</a></p></div></section>${testimonials.length?`<section class="section bg-sand" data-bid="testimonials"><div class="container"><div class="section-head center"><span class="icon-badge">${icon("quote",22)}</span><h2>What Clients Say</h2></div><div class="grid-3">${testimonials.slice(0,3).map(t=>`<div class="card testimonial">${icon("quote",22)}<p class="stars">${Array.from({length:5},(_,i)=>`<span class="${i<Number(t.rating)?"star-on":"star-off"}">${icon("star",14)}</span>`).join("")}</p><p>&ldquo;${esc(t.quote)}&rdquo;</p><p class="author">${esc(t.author_initial_only?(t.author_name||"").split(" ").map((n,i)=>i===0?n:n[0]+".").join(" "):t.author_name)}</p></div>`).join("")}</div></div></section>`:""}${faqBlock(homeFaq)}<section class="section cta-section" data-bid="cta"><div class="container"><span class="icon-badge on-dark">${icon("leaf",24)}</span><h2>Ready to Book Your Appointment?</h2>${rmt.direct_billing?"<p>Direct billing available for most major insurance providers.</p>":""}${booking(rmt,"Book Now")}</div></section></main>`;
 return wrap({rmt,pageTitle:`${rmt.full_name} | Registered Massage Therapist in ${rmt.city}, ${rmt.province}`,metaDescription:(rmt.bio_short||rmt.tagline||`Registered Massage Therapy with ${rmt.full_name} in ${rmt.city}, ${rmt.province}.`).slice(0,160),path:"/index.html",bodyHtml:body,jsonLdBlocks:[schemaMedicalBusiness(rmt,avg,testimonials.length),schemaFAQ(homeFaq),schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"}])]});
}
function buildServicesIndex(d){
 const {rmt,services,faqs}=d, fs=faqs.filter(f=>f.page==="services");
 const svcIcons=["hands","leaf","heart","clock","shield","tag"];
 const body=`<main>${pageHero("hands",`Massage Therapy Services in ${esc(rmt.city)}`,`${esc(rmt.full_name)} offers the following treatments, each tailored to your specific needs and goals.`,"/services.html")}<section class="section" data-bid="grid"><div class="container grid-3">${services.map((s,i)=>`<div class="card"><span class="card-icon">${icon(svcIcons[i%svcIcons.length],26)}</span><h2>${esc(s.name)}</h2><p>${esc(s.short_description||"")}</p><p class="meta">${s.duration_minutes?icon("clock",14)+s.duration_minutes+" min":""}${s.duration_minutes&&s.price_cents?" &middot; ":""}${s.price_cents?icon("tag",14)+money(s.price_cents):""}</p><a href="/services/${esc(s.slug)}.html" class="btn btn-outline">Learn More</a></div>`).join("")}</div></section>${faqBlock(fs)}</main>`;
 return wrap({rmt,pageTitle:`Massage Therapy Services | ${rmt.brand_name||rmt.full_name}`,metaDescription:`Explore massage therapy services offered by ${rmt.full_name} in ${rmt.city}, ${rmt.province}, including duration and pricing.`.slice(0,160),path:"/services.html",bodyHtml:body,jsonLdBlocks:[schemaFAQ(fs),schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"Services",path:"/services.html"}])]});
}
function buildServicePage(d,s){
 const {rmt,faqs}=d, fs=faqs.filter(f=>f.page===`service:${s.slug}`);
 const body=`<main>${pageHero("hands",`${esc(s.name)} in ${esc(rmt.city)}`,esc(s.short_description||""),"/services.html")}<section class="section" data-bid="body"><div class="container two-column"><div class="two-column-left"><h2>What Is ${esc(s.name)}?</h2><p>${esc(s.long_description||s.short_description||"")}</p>${s.benefits?.length?`<h3><span class="inline-icon">${icon("check",18)}</span>Benefits</h3><ul class="icon-list">${s.benefits.map(b=>`<li>${icon("check",16)}${esc(b)}</li>`).join("")}</ul>`:""}${s.conditions_treated?.length?`<h3><span class="inline-icon">${icon("shield",18)}</span>Conditions This Can Help With</h3><ul class="icon-list">${s.conditions_treated.map(c=>`<li>${icon("check",16)}${esc(c)}</li>`).join("")}</ul>`:""}</div><div class="two-column-right"><div class="booking-card">${s.duration_minutes?`<p class="icon-line">${icon("clock",18)}<strong>Duration:</strong>&nbsp;${s.duration_minutes} minutes</p>`:""}${s.price_cents?`<p class="icon-line">${icon("tag",18)}<strong>Price:</strong>&nbsp;${money(s.price_cents)}</p>`:""}${booking(rmt,`Book ${s.name}`)}</div></div></div></section>${faqBlock(fs)}</main>`;
 return wrap({rmt,pageTitle:`${s.name} in ${rmt.city}, ${rmt.province} | ${rmt.brand_name||rmt.full_name}`,metaDescription:(s.short_description||`${s.name} offered by ${rmt.full_name} in ${rmt.city}, ${rmt.province}.`).slice(0,160),path:`/services/${slugify(s.slug)}.html`,bodyHtml:body,jsonLdBlocks:[schemaService(rmt,s),schemaFAQ(fs),schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"Services",path:"/services.html"},{name:s.name,path:`/services/${slugify(s.slug)}.html`}])]});
}
function buildConditionsIndex(d){
 const {rmt,conditions}=d;
 const body=`<main>${pageHero("shield",`Conditions Treated by ${esc(rmt.full_name)}`,`Massage therapy can help with a wide range of conditions. Here's what ${esc(rmt.full_name)} commonly treats in ${esc(rmt.city)}.`,"/conditions.html")}<section class="section" data-bid="grid"><div class="container grid-3">${conditions.map(c=>`<div class="card"><span class="card-icon">${icon("heart",26)}</span><h2>${esc(c.name)}</h2><p>${esc((c.description||"").slice(0,140))}</p><a class="card-link" href="/conditions/${esc(c.slug)}.html">Learn more ${icon("arrow",16)}</a></div>`).join("")}</div></section></main>`;
 return wrap({rmt,pageTitle:`Conditions Treated | ${rmt.brand_name||rmt.full_name}`,metaDescription:`Conditions treated with massage therapy by ${rmt.full_name} in ${rmt.city}, ${rmt.province}.`.slice(0,160),path:"/conditions.html",bodyHtml:body,jsonLdBlocks:[schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"Conditions Treated",path:"/conditions.html"}])]});
}
function buildConditionPage(d,c){
 const {rmt,services}=d,related=services.filter(s=>(c.related_service_slugs||[]).includes(s.slug));
 const direct=((c.description||"").split(". ").slice(0,2).join(". ")+(c.description?".":""));
 const body=`<main>${pageHero("heart",`Can Massage Therapy Help With ${esc(c.name)}?`,esc(direct),"/conditions.html")}<section class="section" data-bid="body"><div class="container"><div class="content-block"><p>${esc(c.description||"")}</p></div>${related.length?`<h2>Recommended Services</h2><div class="grid-3">${related.map(s=>`<div class="card"><span class="card-icon">${icon("hands",26)}</span><h3>${esc(s.name)}</h3><p>${esc(s.short_description||"")}</p><a class="card-link" href="/services/${esc(s.slug)}.html">Learn more ${icon("arrow",16)}</a></div>`).join("")}</div>`:""}<p class="center-cta">${booking(rmt)}</p></div></section></main>`;
 return wrap({rmt,pageTitle:`Massage Therapy for ${c.name} in ${rmt.city}, ${rmt.province}`,metaDescription:(c.description||`How massage therapy can help with ${c.name}.`).slice(0,160),path:`/conditions/${slugify(c.slug)}.html`,bodyHtml:body,jsonLdBlocks:[schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"Conditions Treated",path:"/conditions.html"},{name:c.name,path:`/conditions/${slugify(c.slug)}.html`}])]});
}
function buildAbout(d){
 const {rmt}=d;
 const body=`<main>${pageHero("shield",`About ${esc(rmt.full_name)}`,esc(rmt.credentials||""),"/about.html")}<section class="section" data-bid="bio"><div class="container two-column"><div class="two-column-left"><div class="content-block"><p>${esc(rmt.bio_long||rmt.bio_short||"")}</p></div></div><div class="two-column-right">${(()=>{const p=rmt.photo_url||DEFAULT_IMAGES.portrait;return `<img src="${esc(p)}" alt="${esc(rmt.full_name)}, Registered Massage Therapist" loading="lazy" class="portrait">`;})()}${rmt.insurance_providers?.length?`<h3><span class="inline-icon">${icon("check",18)}</span>Direct Billing Available For</h3><ul class="icon-list">${rmt.insurance_providers.map(p=>`<li>${icon("check",16)}${esc(p)}</li>`).join("")}</ul>`:""}</div></div></section></main>`;
 return wrap({rmt,pageTitle:`About ${rmt.full_name} | ${rmt.brand_name||"Registered Massage Therapist"}`,metaDescription:(rmt.bio_short||`About ${rmt.full_name}, Registered Massage Therapist in ${rmt.city}, ${rmt.province}.`).slice(0,160),path:"/about.html",bodyHtml:body,jsonLdBlocks:[schemaPerson(rmt),schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"About",path:"/about.html"}])]});
}
function buildContact(d){
 const {rmt}=d;
 const body=`<main>${pageHero("mail",`Contact ${esc(rmt.full_name)}`,"","/contact.html")}<section class="section" data-bid="contact"><div class="container contact-grid"><div class="contact-card">${rmt.phone?`<p class="icon-line lg"><a href="tel:${esc(rmt.phone_tel||rmt.phone)}">${icon("phone",20)}${esc(rmt.phone)}</a></p>`:""}${rmt.email?`<p class="icon-line lg"><a href="mailto:${esc(rmt.email)}">${icon("mail",20)}${esc(rmt.email)}</a></p>`:""}${rmt.address?`<p class="icon-line lg">${icon("pin",20)}${esc(rmt.address)}, ${esc(rmt.city)}, ${esc(rmt.province)}</p>`:""}${rmt.hours?`<h3><span class="inline-icon">${icon("clock",18)}</span>Hours</h3><ul class="hours-list">${Object.entries(rmt.hours).map(([day,h])=>`<li><span>${esc(({mon:"Monday",tue:"Tuesday",wed:"Wednesday",thu:"Thursday",fri:"Friday",sat:"Saturday",sun:"Sunday"})[day]||day)}</span><span>${esc(h)}</span></li>`).join("")}</ul>`:""}</div><div class="booking-card center-block">${icon("leaf",30)}<h3>Ready when you are</h3><p>Book your appointment online in a couple of minutes.</p>${booking(rmt)}</div></div></section></main>`;
 return wrap({rmt,pageTitle:`Contact | ${rmt.brand_name||rmt.full_name}`,metaDescription:`Contact ${rmt.full_name} in ${rmt.city}, ${rmt.province} — phone, email, address, and hours.`.slice(0,160),path:"/contact.html",bodyHtml:body,jsonLdBlocks:[schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"Contact",path:"/contact.html"}])]});
}
function buildFaq(d){
 const {rmt,faqs}=d;
 const body=`<main>${pageHero("heart","Frequently Asked Questions","","/faq.html")}${faqBlock(faqs)}</main>`;
 return wrap({rmt,pageTitle:`FAQ | ${rmt.brand_name||rmt.full_name}`,metaDescription:`Common questions about massage therapy with ${rmt.full_name} in ${rmt.city}, ${rmt.province}.`.slice(0,160),path:"/faq.html",bodyHtml:body,jsonLdBlocks:[schemaFAQ(faqs),schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"FAQ",path:"/faq.html"}])]});
}
function buildTestimonials(d){
 const {rmt,testimonials}=d,avg=testimonials.length?testimonials.reduce((s,t)=>s+Number(t.rating||0),0)/testimonials.length:null;
 const body=`<main>${pageHero("quote","Client Testimonials","","/testimonials.html")}<section class="section" data-bid="grid"><div class="container grid-3">${testimonials.map(t=>`<div class="card testimonial">${icon("quote",22)}<p class="stars">${Array.from({length:5},(_,i)=>`<span class="${i<Number(t.rating)?"star-on":"star-off"}">${icon("star",14)}</span>`).join("")}</p><p>&ldquo;${esc(t.quote)}&rdquo;</p><p class="author">${esc(t.author_initial_only?(t.author_name||"").split(" ").map((n,i)=>i===0?n:n[0]+".").join(" "):t.author_name)}</p></div>`).join("")}</div></section></main>`;
 return wrap({rmt,pageTitle:`Client Testimonials | ${rmt.brand_name||rmt.full_name}`,metaDescription:`What clients say about massage therapy with ${rmt.full_name} in ${rmt.city}, ${rmt.province}.`.slice(0,160),path:"/testimonials.html",bodyHtml:body,jsonLdBlocks:[schemaMedicalBusiness(rmt,avg,testimonials.length),schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"Testimonials",path:"/testimonials.html"}])]});
}
function buildBlogIndex(d){
 const {rmt,posts}=d;
 const body=`<main>${pageHero("leaf","Blog",`Massage therapy tips and insights from ${esc(rmt.full_name)}.`,"/blog/index.html")}<section class="section" data-bid="grid"><div class="container grid-3">${posts.map(p=>`<div class="card">${p.cover_image_url?`<img src="${esc(p.cover_image_url)}" alt="${esc(p.title)}" loading="lazy" class="card-image">`:`<img src="${DEFAULT_IMAGES.blog}" alt="${esc(p.title)}" loading="lazy" class="card-image">`}<h2>${esc(p.title)}</h2><p>${esc(p.excerpt||"")}</p><a class="card-link" href="/blog/${esc(p.slug)}.html">Read more ${icon("arrow",16)}</a></div>`).join("")}</div></section></main>`;
 return wrap({rmt,pageTitle:`Blog | ${rmt.brand_name||rmt.full_name}`,metaDescription:`Massage therapy tips and insights from ${rmt.full_name} in ${rmt.city}, ${rmt.province}.`.slice(0,160),path:"/blog/index.html",bodyHtml:body,jsonLdBlocks:[schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"Blog",path:"/blog/index.html"}])]});
}
function buildBlogPost(d,p){
 const {rmt}=d;
 const date=p.published_at?new Date(p.published_at).toLocaleDateString("en-CA",{year:"numeric",month:"long",day:"numeric"}):"";
 const body=`<main><section class="section" data-bid="header"><div class="container narrow"><h1>${esc(p.title)}</h1>${date?`<p class="meta icon-line">${icon("clock",16)}${date}</p>`:""}${p.cover_image_url?`<img src="${esc(p.cover_image_url)}" alt="${esc(p.title)}" loading="lazy" class="post-image">`:""}</div></section><article class="section" data-bid="body"><div class="container narrow"><div class="post-content">${p.content_html||""}</div><p class="center-cta">${booking(rmt)}</p></div></article></main>`;
 return wrap({rmt,pageTitle:`${p.title} | ${rmt.brand_name||rmt.full_name}`,metaDescription:(p.excerpt||p.title).slice(0,160),path:`/blog/${slugify(p.slug)}.html`,bodyHtml:body,jsonLdBlocks:[jsonClean({"@context":"https://schema.org","@type":"BlogPosting","headline":p.title,"image":p.cover_image_url||undefined,"datePublished":p.published_at||undefined,"author":{"@type":"Person","name":rmt.full_name}}),schemaBreadcrumb(rmt,[{name:"Home",path:"/index.html"},{name:"Blog",path:"/blog/index.html"},{name:p.title,path:`/blog/${slugify(p.slug)}.html`}])]});
}

/**
 * Server-side replacement for the old browser generate(): builds every
 * page into a Map<path, html> using the data pulled from Supabase in
 * build.ts. No "which pages to build" checkboxes — v1 always builds the
 * full site; easy to add per-page toggles back via a settings table later.
 */
export function generateSite(d: {
  rmt: any; services: any[]; conditions: any[]; testimonials: any[]; faqs: any[]; posts: any[];
}, buildOpts: BuildOpts): Map<string, string> {
  setOpts(buildOpts);
  const files = new Map<string, string>();
  const urls: string[] = [];
  const add = (p: string, c: string) => { files.set(p, c); urls.push("/" + p); };
  const r = d.rmt;

  add("index.html", buildIndex(d));
  add("services.html", buildServicesIndex(d));
  add("conditions.html", buildConditionsIndex(d));
  add("about.html", buildAbout(d));
  add("contact.html", buildContact(d));
  add("faq.html", buildFaq(d));
  add("testimonials.html", buildTestimonials(d));
  add("blog/index.html", buildBlogIndex(d));
  d.services.forEach((s) => { const p = `/services/${slugify(s.slug)}.html`; add(p.slice(1), buildServicePage(d, s)); });
  d.conditions.forEach((c) => { const p = `/conditions/${slugify(c.slug)}.html`; add(p.slice(1), buildConditionPage(d, c)); });
  d.posts.forEach((p) => { const path = `/blog/${slugify(p.slug)}.html`; add(path.slice(1), buildBlogPost(d, p)); });
  add("sitemap.xml", buildSitemap(r, urls));
  add("robots.txt", buildRobots(r));
  add("css/style.css", siteCss(buildOpts.theme));
  add("js/app.js", SITE_JS);

  return files;
}
function buildSitemap(r,urls){return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.filter(u=>u.endsWith(".html")).map(u=>`  <url><loc>${esc(r.domain?`https://${r.domain}${u}`:u)}</loc></url>`).join("\n")}\n</urlset>`}
function buildRobots(r){return `User-agent: *\nAllow: /\n\nSitemap: ${r.domain?`https://${r.domain}`:""}/sitemap.xml`}


const THEMES = [
  { id:"sage",   name:"Sage Spa",       sage:"#5f7f63", sageDark:"#3a5240", clay:"#bd7148", clayDark:"#9a5936", sand:"#f5f0e5", cream:"#fbf9f4", ink:"#232c26", muted:"#66706a", border:"#e3ddcd", fontDisplay:"'Fraunces',Georgia,serif", fontBody:"'Work Sans',-apple-system,BlinkMacSystemFont,sans-serif", googleFonts:"Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600;700" },
  { id:"ocean",  name:"Ocean Calm",     sage:"#2f7d84", sageDark:"#1e5459", clay:"#e8785a", clayDark:"#c85c3f", sand:"#eaf3f2", cream:"#f6fbfa", ink:"#1c2b2c", muted:"#5b6e6f", border:"#d8e6e4", fontDisplay:"'Cormorant Garamond',Georgia,serif", fontBody:"'Nunito Sans',-apple-system,BlinkMacSystemFont,sans-serif", googleFonts:"Cormorant+Garamond:wght@500;600;700&family=Nunito+Sans:wght@400;500;600;700" },
  { id:"blush",  name:"Blush Botanical",sage:"#7a6a52", sageDark:"#544731", clay:"#c07a86", clayDark:"#a15866", sand:"#f6efe9", cream:"#fcf8f4", ink:"#2b2420", muted:"#786a5c", border:"#e8dbcd", fontDisplay:"'Playfair Display',Georgia,serif", fontBody:"'Karla',-apple-system,BlinkMacSystemFont,sans-serif", googleFonts:"Playfair+Display:wght@500;600;700&family=Karla:wght@400;500;600;700" },
  { id:"midnight",name:"Midnight Zen",  sage:"#8a9a8f", sageDark:"#c9a35a", clay:"#c9a35a", clayDark:"#a5813f", sand:"#1c2420", cream:"#161c19", ink:"#eef1ee", muted:"#a7b3ac", border:"#2c362f", fontDisplay:"'Marcellus',Georgia,serif", fontBody:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif", googleFonts:"Marcellus&family=Inter:wght@400;500;600;700", dark:true },
  { id:"terracotta",name:"Warm Terracotta",sage:"#4c6b4f", sageDark:"#324a35", clay:"#c1592f", clayDark:"#9c4523", sand:"#f2e9dd", cream:"#faf5ee", ink:"#2a2420", muted:"#71675c", border:"#e4d6c2", fontDisplay:"'Libre Caslon Text',Georgia,serif", fontBody:"'Mulish',-apple-system,BlinkMacSystemFont,sans-serif", googleFonts:"Libre+Caslon+Text:wght@400;700&family=Mulish:wght@400;500;600;700" }
];
function getTheme(theme){ return THEMES.find(t=>t.id===theme) || THEMES[0]; }
function fontsLinkTag(theme){
  const t=getTheme(theme);
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=${t.googleFonts}&display=swap" rel="stylesheet">`;
}
function siteCss(theme){
 const t=getTheme(theme);
 return `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --sage:${t.sage};--sage-dark:${t.sageDark};--clay:${t.clay};--clay-dark:${t.clayDark};
  --sand:${t.sand};--cream:${t.cream};--ink:${t.ink};--muted:${t.muted};--border:${t.border};
  --radius:16px;--radius-sm:10px;
  --font-display:${t.fontDisplay};--font-body:${t.fontBody};
  --shadow:0 12px 32px rgba(0,0,0,${t.dark?".35":".08"});
  --surface:${t.dark?"#1f2a24":"#ffffff"};--surface-a:${t.dark?"rgba(31,42,36,.92)":"rgba(255,255,255,.92)"};
}
body{font-family:var(--font-body);color:var(--ink);line-height:1.65;background:${t.dark?"var(--cream)":"#fff"};font-size:16px}
.container{max-width:1160px;margin:0 auto;padding:0 24px}
.container.narrow{max-width:760px}
a{color:var(--sage-dark);text-decoration:none}
h1,h2,h3{font-family:var(--font-display);font-weight:600;line-height:1.2;color:var(--ink)}
h1{font-size:clamp(2rem,4.2vw,3rem);margin-bottom:14px;letter-spacing:-.01em}
h2{font-size:clamp(1.5rem,2.6vw,2rem);margin-bottom:14px}
h3{font-size:1.2rem;margin-bottom:10px;display:flex;align-items:center;gap:8px}
p{color:var(--ink)}
.icon{display:inline-block;vertical-align:-3px;flex-shrink:0}
.inline-icon{display:inline-flex;color:var(--clay)}

/* Header */
.site-header{border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface-a);backdrop-filter:blur(8px);z-index:10;transition:box-shadow .2s ease}
.site-header.is-scrolled{box-shadow:0 2px 16px rgba(35,44,38,.07)}
.topbar{background:var(--sage-dark);color:#fff;font-size:.82rem}
.topbar-inner{display:flex;align-items:center;justify-content:space-between;padding:8px 24px}
.topbar .icon-line{color:#fff;gap:6px}
.topbar .icon-line .icon{color:rgba(255,255,255,.75)}
.header-inner{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;gap:16px;flex-wrap:wrap;position:relative}
.brand{display:flex;align-items:center;gap:9px;font-family:var(--font-display);font-weight:600;font-size:1.25rem;color:var(--ink)}
.brand .icon{color:var(--clay)}
.main-nav{display:flex;gap:22px;flex-wrap:wrap}
.main-nav a{position:relative;color:var(--muted);font-size:.92rem;font-weight:500;padding:6px 0}
.main-nav a::after{content:"";position:absolute;left:0;right:100%;bottom:0;height:2px;background:var(--clay);transition:right .2s ease}
.main-nav a.active,.main-nav a:hover{color:var(--sage-dark)}
.main-nav a.active::after,.main-nav a:hover::after{right:0}
.nav-toggle{display:none}
.hamburger{display:none;flex-direction:column;justify-content:center;gap:5px;width:34px;height:34px;cursor:pointer}
.hamburger span{display:block;height:2px;width:100%;background:var(--ink);border-radius:2px;transition:transform .25s ease,opacity .25s ease}

/* Buttons */
.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:999px;font-weight:600;font-size:.92rem;transition:transform .12s ease,box-shadow .12s ease,background .15s ease}
.btn.is-pressed{transform:scale(.96)}
.btn-primary{background:var(--clay);color:#fff}
.btn-primary:hover{background:var(--clay-dark);box-shadow:0 6px 18px rgba(189,113,72,.35)}
.btn-outline{border:1.5px solid var(--sage);color:var(--sage-dark)}
.btn-outline:hover{background:var(--sand)}
.btn-lg{padding:15px 28px;font-size:1rem}

/* Hero */
.hero{background:var(--cream);padding:72px 0 0;position:relative;overflow:hidden}
.hero-inner{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center;padding-bottom:56px}
.eyebrow-mark{display:inline-flex;align-items:center;gap:7px;color:var(--sage-dark);font-weight:600;font-size:.85rem;margin-bottom:16px}
.hero-desc{max-width:480px;margin:0 0 26px;color:var(--muted);font-size:1.05rem}
.hero-actions{display:flex;gap:14px;flex-wrap:wrap}
.hero-note{display:flex;align-items:center;gap:8px;margin-top:20px;color:var(--sage-dark);font-size:.9rem;font-weight:500}
.hero-art{position:relative;height:360px;border-radius:24px;overflow:visible}
.hero-art img{width:100%;height:100%;object-fit:cover;border-radius:24px;box-shadow:var(--shadow)}
.hero-icon{position:absolute;background:var(--surface);border-radius:50%;box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center;color:var(--sage-dark)}
.hero-icon.a{width:78px;height:78px;top:14%;left:8%}
.hero-icon.b{width:60px;height:60px;bottom:12%;left:38%;color:var(--clay)}
.hero-icon.c{width:56px;height:56px;top:34%;right:6%}
.wave-divider{line-height:0;color:var(--cream)}
.wave-divider svg{width:100%;height:44px;display:block}

/* Hero layout: centered */
.hero-centered{text-align:center;padding-bottom:0}
.hero-centered-copy{max-width:640px;margin:0 auto}
.hero-centered .hero-actions{justify-content:center}
.hero-banner{margin-top:36px;width:100%;height:340px;overflow:hidden}
.hero-banner img{width:100%;height:100%;object-fit:cover}

/* Hero layout: full-bleed */
.hero-fullbleed{position:relative;min-height:520px;display:flex;align-items:center;padding:0;overflow:hidden}
.hero-fullbleed-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.hero-fullbleed-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.55));z-index:1}
.hero-fullbleed-copy{position:relative;z-index:2;max-width:640px;padding:100px 24px}
.hero-fullbleed-copy h1,.hero-fullbleed-copy p,.hero-fullbleed-copy .eyebrow-mark,.hero-fullbleed-copy .hero-note{color:#fff}
.hero-fullbleed-copy .hero-desc{color:rgba(255,255,255,.88)}
.hero-fullbleed .btn-outline{border-color:rgba(255,255,255,.6);color:#fff}
.hero-fullbleed .btn-outline:hover{background:rgba(255,255,255,.12)}
.page-hero{background:linear-gradient(${t.cream}ee,${t.cream}ee),url('${DEFAULT_IMAGES.hero}') center/cover;padding:64px 0;text-align:center}
.page-hero .icon-badge{margin:0 auto 18px}
.page-hero-split{background:var(--cream);text-align:left;padding:56px 0}
.page-hero-split-inner{display:grid;grid-template-columns:1.2fr .8fr;gap:36px;align-items:center}
.page-hero-split .icon-badge{margin-bottom:14px}
.page-hero-split-img{height:220px;border-radius:var(--radius);overflow:hidden}
.page-hero-split-img img{width:100%;height:100%;object-fit:cover}
.page-hero-fullbleed{position:relative;min-height:280px;display:flex;align-items:center;padding:0;overflow:hidden;text-align:left}
.page-hero-fullbleed-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.page-hero-fullbleed-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.55));z-index:1}
.page-hero-fullbleed-copy{position:relative;z-index:2;padding:56px 24px;max-width:640px}
.page-hero-fullbleed-copy h1,.page-hero-fullbleed-copy p{color:#fff}

/* Sections */
.section{padding:64px 0}
.bg-sand{background:var(--sand)}
.section-head{max-width:640px;margin-bottom:36px}
.section-head.center{margin-left:auto;margin-right:auto;text-align:center}
.section-head .icon-badge{margin-bottom:14px}
.lede{color:var(--muted)}
.icon-badge{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:var(--sand);color:var(--sage-dark)}
.icon-badge.on-dark{background:rgba(255,255,255,.14);color:#fff;margin-bottom:14px}
.center-cta{text-align:center;margin-top:8px}

/* Cards */
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
.card{border:1px solid var(--border);border-radius:var(--radius);padding:28px;background:var(--surface);transition:box-shadow .2s ease,transform .2s ease}
.card:hover{box-shadow:var(--shadow);transform:translateY(-2px)}
.card-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:var(--sand);color:var(--sage-dark);margin-bottom:14px}
.card-link{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--sage-dark)}
.card-image,.card-image-placeholder{width:100%;height:170px;border-radius:10px;margin-bottom:14px;object-fit:cover}
.card-image-placeholder{display:flex;align-items:center;justify-content:center;background:var(--sand);color:var(--sage)}

/* Two column / lists */
.two-column{display:grid;grid-template-columns:1.4fr 1fr;gap:48px;align-items:start}
.icon-list{list-style:none;display:grid;gap:9px;margin:4px 0 18px}
.icon-list li{display:flex;align-items:start;gap:9px;color:var(--ink)}
.icon-list .icon{color:var(--clay);margin-top:3px}
.portrait{width:100%;border-radius:var(--radius)}
.portrait-placeholder{width:100%;aspect-ratio:4/5;border-radius:var(--radius);background:var(--sand);display:flex;align-items:center;justify-content:center;color:var(--sage)}
.booking-card{border:1px solid var(--border);border-radius:var(--radius);padding:28px;background:var(--sand)}
.booking-card.center-block{text-align:center}
.booking-card.center-block .icon{color:var(--clay);margin-bottom:10px}

/* Contact */
.contact-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:36px;align-items:start}
.contact-card{border:1px solid var(--border);border-radius:var(--radius);padding:28px}
.icon-line{display:flex;align-items:center;gap:10px;margin-bottom:10px;color:var(--ink)}
.icon-line a{display:flex;align-items:center;gap:10px;color:var(--ink)}
.icon-line.lg{font-size:1.05rem;font-weight:500}
.icon-line .icon{color:var(--clay)}
.hours-list{list-style:none;display:grid;gap:7px}
.hours-list li{display:flex;justify-content:space-between;font-size:.92rem;padding:7px 0;border-bottom:1px dashed var(--border)}
.hours-list li span:first-child{color:var(--muted)}

/* FAQ accordion */
.faq-section .section-head{margin-bottom:24px}
.faq-list{display:grid;gap:12px}
.faq-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 20px}
.faq-item summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;cursor:pointer;font-weight:600;font-family:var(--font-display);font-size:1.05rem}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary .icon{color:var(--sage);transition:transform .2s ease;flex-shrink:0}
.faq-item[open] summary .icon{transform:rotate(180deg)}
.faq-item p{padding-bottom:18px;color:var(--muted)}

/* Testimonials */
.testimonial{position:relative}
.testimonial .icon{color:var(--sand)}
.testimonial .stars{display:flex;gap:2px;margin:10px 0 12px}
.star-on{color:#c9922f}
.star-off{color:#e6e0d2}
.testimonial p{margin:0 0 6px}
.testimonial .author{color:var(--muted);font-size:.9rem;font-weight:600;margin-top:10px}

/* CTA */
.cta-section{background:var(--sage-dark);color:#fff;text-align:center}
.cta-section h2{color:#fff}
.cta-section .btn-outline{border-color:rgba(255,255,255,.5);color:#fff}
.cta-section .btn-outline:hover{background:rgba(255,255,255,.1)}

/* Footer */
.site-footer{background:var(--ink);color:#d7dcd8;padding:48px 0 20px;margin-top:0}
.footer-grid{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:36px}
.footer-grid h3{color:#fff;display:flex;align-items:center;gap:8px}
.footer-grid h3 .icon{color:var(--clay)}
.footer-grid h4{color:#fff;font-family:var(--font-body);font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;font-weight:600}
.footer-grid a{color:#d7dcd8;display:block;margin-bottom:8px}
.footer-grid .icon-line a{color:#d7dcd8}
.footer-bottom{margin-top:28px;padding-top:18px;border-top:1px solid #38403b;font-size:.85rem;opacity:.75}
.meta{color:var(--muted);font-size:.88rem}
.post-image{width:100%;border-radius:var(--radius);margin:20px 0}
@media(max-width:860px){
  .grid-3{grid-template-columns:1fr}
  .two-column,.contact-grid,.hero-inner{grid-template-columns:1fr}
  .page-hero-split-inner{grid-template-columns:1fr}
  .page-hero-split-img{order:-1;height:180px}
  .hero-art{order:-1;height:220px}
  .hero-banner{height:220px}
  .hero-fullbleed{min-height:400px}
  .hero-fullbleed-copy{padding:64px 24px}
  .footer-grid{grid-template-columns:1fr;gap:24px}
  .topbar-inner{font-size:.76rem}
  .hamburger{display:flex}
  .main-nav{display:flex;flex-direction:column;align-items:stretch;gap:0;position:absolute;top:100%;left:0;right:0;background:var(--surface);border-bottom:1px solid var(--border);box-shadow:0 12px 24px rgba(35,44,38,.08);max-height:0;overflow:hidden;transition:max-height .3s ease;padding:0 24px}
  .main-nav a{padding:14px 0;border-bottom:1px solid var(--border)}
  .main-nav a::after{display:none}
  .nav-toggle:checked ~ .main-nav{max-height:520px;padding:8px 24px 16px}
  .nav-toggle:checked ~ .hamburger span:nth-child(1){transform:translateY(7px) rotate(45deg)}
  .nav-toggle:checked ~ .hamburger span:nth-child(2){opacity:0}
  .nav-toggle:checked ~ .hamburger span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
}

/* App-like transitions (progressive enhancement — see js/app.js) */
#app-view{transition:opacity .18s ease}
#app-view.is-leaving{opacity:.4}
#app-view.is-entering{opacity:1}
.fade-target{opacity:0;transform:translateY(10px);transition:opacity .4s ease,transform .4s ease}
.fade-target.is-visible{opacity:1;transform:translateY(0)}
@media (prefers-reduced-motion: reduce){
  #app-view,.fade-target,.btn{transition:none!important}
  .fade-target{opacity:1!important;transform:none!important}
}
::view-transition-old(root),::view-transition-new(root){animation-duration:.22s}
`;

export const SITE_JS = `(function () {
  var view = document.getElementById('app-view');
  if (!view) return;

  function isSameOriginHtmlLink(a) {
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
    if (a.origin !== location.origin) return false;
    if (a.getAttribute('href') && a.getAttribute('href').indexOf('#') === 0) return false;
    return true;
  }

  async function navigateTo(url, addToHistory) {
    try {
      view.classList.add('is-leaving');
      const res = await fetch(url, { headers: { 'X-Requested-With': 'app-nav' } });
      if (!res.ok) { location.href = url; return; }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const newView = doc.getElementById('app-view');
      const newTitle = doc.querySelector('title');
      if (!newView) { location.href = url; return; }

      const swap = function () {
        view.innerHTML = newView.innerHTML;
        if (newTitle) document.title = newTitle.textContent;
        var newPath = new URL(url, location.origin).pathname;
        document.querySelectorAll('.main-nav a').forEach(function (a) {
          a.classList.toggle('active', a.getAttribute('href') === newPath);
        });
        window.scrollTo(0, 0);
        view.classList.remove('is-leaving');
        view.classList.add('is-entering');
        setTimeout(function () { view.classList.remove('is-entering'); }, 250);
        initScrollFades();
      };

      if (document.startViewTransition) {
        document.startViewTransition(swap);
      } else {
        swap();
      }
      if (addToHistory) history.pushState({ appNav: true }, '', url);
    } catch (e) {
      location.href = url;
    }
  }

  document.addEventListener('click', function (e) {
    var a = e.target instanceof Element ? e.target.closest('a') : null;
    if (!isSameOriginHtmlLink(a)) return;
    e.preventDefault();
    navigateTo(a.getAttribute('href'), true);
  });

  window.addEventListener('popstate', function () {
    navigateTo(location.pathname, false);
  });

  var header = document.querySelector('.site-header');
  if (header) {
    var scrolled = false;
    window.addEventListener('scroll', function () {
      var now = window.scrollY > 12;
      if (now !== scrolled) { header.classList.toggle('is-scrolled', now); scrolled = now; }
    }, { passive: true });
  }

  function initScrollFades() {
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.card:not(.fade-target), .faq-item:not(.fade-target), .content-block:not(.fade-target)').forEach(function (el) {
      el.classList.add('fade-target');
      io.observe(el);
    });
  }
  initScrollFades();

  document.addEventListener('pointerdown', function (e) {
    var btn = e.target instanceof Element ? e.target.closest('.btn') : null;
    if (btn) btn.classList.add('is-pressed');
  });
  ['pointerup', 'pointerleave'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      var btn = e.target instanceof Element ? e.target.closest('.btn') : null;
      if (btn) btn.classList.remove('is-pressed');
    });
  });
})();
`;

export { THEMES };
