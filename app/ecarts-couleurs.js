"use strict";
// Demi-colonnes de l'agenda : « Standard » (lien iCal, bleu) et « Lise » (site, orange), avec légende.
(function () {
	const st = document.createElement("style");
	st.textContent = `
:root{--ec-std:#2f6fb0;--ec-lise:#d9822b}
.ec-sub{gap:2px;margin-top:3px}
.ec-sub i{color:#fff!important;border-radius:4px;padding:2px 0;text-align:center;font-size:8px;letter-spacing:0;overflow:hidden;text-overflow:clip;white-space:nowrap}
.ec-sub i:first-child{background:var(--ec-std)}
.ec-sub i:last-child{background:var(--ec-lise)}
.ag-col.ec-ics{background-color:color-mix(in srgb,var(--ec-std) 9%,transparent);border-left:2px solid var(--ec-std)}
.ag-col.ec-lise{background-color:color-mix(in srgb,var(--ec-lise) 11%,transparent);border-left:2px solid var(--ec-lise)}
.ag-col.ec-ics + .ag-col.ec-lise{border-left:2px solid var(--ec-lise)}
.ag-col.ec-ics .ag-cours{box-shadow:inset 0 3px 0 var(--ec-std)}
.ag-col.ec-lise .ag-cours{box-shadow:inset 0 3px 0 var(--ec-lise)}
.ag-col.ec-ics .ag-cours.ec-d{outline:2px dashed var(--ec-std)}
.ag-col.ec-lise .ag-cours.ec-d{outline:2px dashed var(--ec-lise)}
.ec-legende{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:13px;margin:0 0 8px}
.ec-legende span{display:inline-flex;align-items:center;gap:6px}
.ec-legende b{display:inline-block;width:14px;height:14px;border-radius:4px}
`;
	document.head.appendChild(st);
	const orig = window.grilleSemaine;
	window.grilleSemaine = function (...a) {
		const html = orig.apply(this, a);
		if (!html.includes("ec-sub")) return html;
		const legende = '<div class="ec-legende"><span><b style="background:var(--ec-std)"></b>Standard = lien iCal</span><span><b style="background:var(--ec-lise)"></b>Lise = site</span><span class="petit">pointillés = différence</span></div>';
		return legende + html.replace(/<i>ICS<\/i><i>Lise<\/i>/g, "<i>Std</i><i>Lise</i>");
	};
})();
