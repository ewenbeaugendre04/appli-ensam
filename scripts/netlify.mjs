// Retrait du calendrier « cours seulement » : supprime le site Netlify cours-ensam (exécution unique).
const TOKEN = process.env.NETLIFY_TOKEN;
const API = "https://api.netlify.com/api/v1";
const h = { Authorization: `Bearer ${TOKEN}` };
if (!TOKEN) { console.log("Pas de NETLIFY_TOKEN : rien à supprimer."); process.exit(0); }
const sites = await (await fetch(`${API}/sites?filter=all&per_page=100`, { headers: h })).json();
for (const s of sites.filter((s) => s.name === "cours-ensam" || s.name.startsWith("cours-ensam-"))) {
	const r = await fetch(`${API}/sites/${s.id}`, { method: "DELETE", headers: h });
	console.log(`Site Netlify ${s.name} supprimé : HTTP ${r.status}`);
}
