// Synchronisation horaire : Lise (iCal) + tâches + partiels → events.json (dépôt privé) + abonnement .ics (site)
// Aucune dépendance externe. Node 20+.
import { writeFile, mkdir } from "node:fs/promises";

const TOKEN = process.env.DATA_TOKEN;
const DATA_REPO = process.env.DATA_REPO || "ewenbeaugendre04/appli-ensam-data";
const OUT_DIR = process.env.OUT_DIR || "_site";
const LOCAL_ICS = process.env.LOCAL_ICS; // pour les tests : fichier .ics local au lieu de Lise
const TZ = "Europe/Paris";

// ---------- API GitHub (dépôt de données privé) ----------
async function gh(path, opts = {}) {
	const res = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${path}`, {
		...opts,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			...(opts.headers || {}),
		},
	});
	return res;
}

async function readJson(path, fallback) {
	if (!TOKEN) return fallback;
	const res = await gh(path);
	if (res.status === 404) return fallback;
	if (!res.ok) throw new Error(`Lecture ${path} impossible : ${res.status}`);
	const j = await res.json();
	return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha };
}

async function writeJson(path, data, sha, message) {
	const body = {
		message,
		content: Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64"),
		committer: { name: "Appli ENSAM", email: "appli-ensam@users.noreply.github.com" },
	};
	if (sha) body.sha = sha;
	const res = await gh(path, { method: "PUT", body: JSON.stringify(body) });
	if (!res.ok) throw new Error(`Écriture ${path} impossible : ${res.status} ${await res.text()}`);
}

// ---------- Dates ----------
function tzOffsetMs(utcMs, tz = TZ) {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone: tz, hourCycle: "h23",
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit",
	});
	const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
	const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
	return asUtc - utcMs;
}
export function parisToUtc(y, mo, d, h = 0, mi = 0, s = 0) {
	const guess = Date.UTC(y, mo - 1, d, h, mi, s);
	let t = guess - tzOffsetMs(guess);
	t = guess - tzOffsetMs(t);
	return new Date(t);
}
function parseIcsDate(value, params) {
	const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
	if (!m) return null;
	const [, y, mo, d, h, mi, s, z] = m;
	if (!h) return { date: parisToUtc(+y, +mo, +d), allDay: true };
	if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
	// Heure locale (TZID ou flottante) : traitée comme heure de Paris
	return { date: parisToUtc(+y, +mo, +d, +h, +mi, +s), allDay: false };
}

// ---------- Lecture iCal ----------
function unescapeText(t) {
	return t.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
export function parseIcs(text) {
	const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
	const events = [];
	let cur = null;
	for (const line of lines) {
		if (line === "BEGIN:VEVENT") { cur = {}; continue; }
		if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
		if (!cur) continue;
		const idx = line.indexOf(":");
		if (idx < 0) continue;
		const left = line.slice(0, idx);
		const value = line.slice(idx + 1);
		const [name, ...rawParams] = left.split(";");
		const params = Object.fromEntries(rawParams.map((p) => p.split("=")));
		cur[name.toUpperCase()] = { value, params };
	}
	return events;
}

function field(desc, key) {
	const m = desc.match(new RegExp(`-[ \\t]*${key}[ \\t]*:[ \\t]*(.*)`));
	return m ? m[1].trim() : "";
}

const TYPE_LABELS = { CM: "CM", ED_TD: "TD", TD: "TD", TPS: "TP", TP: "TP", TRAVAIL_AUTONOME: "Travail autonome", PROJET: "Projet", EXAMEN: "Examen", TEST: "Évaluation", REUNION: "Réunion" };

export function normaliseLise(raw) {
	const out = [];
	for (const e of raw) {
		if (!e.DTSTART) continue;
		const start = parseIcsDate(e.DTSTART.value, e.DTSTART.params);
		const end = e.DTEND ? parseIcsDate(e.DTEND.value, e.DTEND.params) : null;
		if (!start) continue;
		const desc = e.DESCRIPTION ? unescapeText(e.DESCRIPTION.value) : "";
		const summary = e.SUMMARY ? unescapeText(e.SUMMARY.value).trim() : "";
		const module = field(desc, "MODULES");
		const typeRaw = field(desc, "TYPE_ACTIVITE");
		const titre = module || summary || "Cours";
		const examen = typeRaw === "EXAMEN" || typeRaw === "TEST" || /\b(partiel|examen|contr[ôo]le|interro)\b/i.test(titre);
		out.push({
			uid: e.UID ? e.UID.value : `${start.date.toISOString()}-${titre}`,
			titre,
			module,
			code: summary,
			type: TYPE_LABELS[typeRaw] || typeRaw || "",
			examen,
			debut: start.date.toISOString(),
			fin: (end ? end.date : new Date(start.date.getTime() + 3600e3)).toISOString(),
			journee: start.allDay,
			salle: e.LOCATION ? unescapeText(e.LOCATION.value).trim() : "",
			profs: field(desc, "INTERVENANTS"),
			groupes: field(desc, "GROUPES"),
		});
	}
	out.sort((a, b) => a.debut.localeCompare(b.debut));
	return out;
}

async function fetchLise(liseId) {
	if (LOCAL_ICS) {
		const { readFile } = await import("node:fs/promises");
		return readFile(LOCAL_ICS, "utf8");
	}
	let lastErr;
	// Lise coupe parfois la connexion : jusqu'à 3 essais espacés, en https puis http
	const essais = ["https://lise.ensam.eu/ical_apprenant/", "http://lise.ensam.eu/ical_apprenant/", "https://lise.ensam.eu/ical_apprenant/", "https://lise.ensam.eu/ical_apprenant/"];
	for (const [i, base] of essais.entries()) {
		if (i) await new Promise((r) => setTimeout(r, 5000 * i));
		try {
			const res = await fetch(base + encodeURIComponent(liseId), { headers: { "cache-control": "no-cache", "User-Agent": "Mozilla/5.0 (Appli ENSAM)" }, signal: AbortSignal.timeout(30000) });
			if (res.ok) {
				const t = await res.text();
				if (t.includes("BEGIN:VCALENDAR")) return t;
				lastErr = new Error("Réponse Lise sans calendrier");
			} else lastErr = new Error(`Lise a répondu ${res.status}`);
		} catch (err) { lastErr = err; }
	}
	throw lastErr;
}

// ---------- Écriture iCal ----------
function esc(t = "") {
	return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function fold(line) {
	const bytes = Buffer.from(line, "utf8");
	if (bytes.length <= 74) return line;
	const parts = [];
	let cur = "";
	for (const ch of line) {
		if (Buffer.byteLength(cur + ch, "utf8") > 73) { parts.push(cur); cur = ch; } else cur += ch;
	}
	parts.push(cur);
	return parts.join("\r\n ");
}
const utcStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function dateOnly(iso) {
	// "2026-11-12" → "20261112" ; ISO complet → date de Paris
	if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.replace(/-/g, "");
	const p = new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
	return p.replace(/-/g, "");
}
function nextDay(yyyymmdd) {
	const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + 1));
	return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function alarm(trigger, text) {
	return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(text)}`, `TRIGGER:${trigger}`, "END:VALARM"];
}

export function buildIcs({ events, tasks, partiels, nom }) {
	const now = utcStamp(new Date());
	const L = [
		"BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Appli ENSAM//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
		`X-WR-CALNAME:${esc(nom)}`, `X-WR-TIMEZONE:${TZ}`,
		"REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
	];
	for (const e of events) {
		const desc = [e.doute && "Version à confirmer : le lien iCal et le site Lise ne sont pas d'accord.", e.type && `Type : ${e.type}`, e.module && `Module : ${e.module}`, e.profs && `Intervenants : ${e.profs}`, e.groupes && `Groupes : ${e.groupes}`].filter(Boolean).join("\n");
		L.push("BEGIN:VEVENT", `UID:lise-${esc(e.uid)}`, `DTSTAMP:${now}`);
		if (e.journee) L.push(`DTSTART;VALUE=DATE:${dateOnly(e.debut)}`, `DTEND;VALUE=DATE:${dateOnly(e.fin)}`);
		else L.push(`DTSTART:${utcStamp(e.debut)}`, `DTEND:${utcStamp(e.fin)}`);
		L.push(`SUMMARY:${esc((e.doute ? "❓ " : "") + (e.examen ? "🎓 " : "") + (e.type ? `${e.type} · ` : "") + e.titre)}`);
		if (e.salle) L.push(`LOCATION:${esc(e.salle)}`);
		if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
		if (e.examen) L.push(...alarm("-P7D", `Partiel dans 7 jours : ${e.titre}`), ...alarm("-P1D", `Partiel demain : ${e.titre}`));
		L.push("END:VEVENT");
	}
	for (const p of partiels) {
		if (!p.date) continue;
		L.push("BEGIN:VEVENT", `UID:partiel-${esc(p.id)}@appli-ensam`, `DTSTAMP:${now}`);
		if (p.heureDebut) {
			const [y, mo, d] = p.date.split("-").map(Number);
			const [h, mi] = p.heureDebut.split(":").map(Number);
			const s = parisToUtc(y, mo, d, h, mi);
			let f = new Date(s.getTime() + 2 * 3600e3);
			if (p.heureFin) { const [h2, m2] = p.heureFin.split(":").map(Number); f = parisToUtc(y, mo, d, h2, m2); }
			L.push(`DTSTART:${utcStamp(s)}`, `DTEND:${utcStamp(f)}`);
		} else {
			const d = dateOnly(p.date);
			L.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${nextDay(d)}`);
		}
		L.push(`SUMMARY:${esc("🎓 Partiel · " + (p.titre || p.matiere || ""))}`);
		if (p.salle) L.push(`LOCATION:${esc(p.salle)}`);
		const descP = [p.description, p.note].filter(Boolean).join("\n");
		if (descP) L.push(`DESCRIPTION:${esc(descP)}`);
		L.push(...alarm("-P7D", `Partiel dans 7 jours : ${p.titre}`), ...alarm("-P1D", `Partiel demain : ${p.titre}`));
		L.push("END:VEVENT");
	}
	for (const t of tasks) {
		if (!t.echeance || t.fait) continue;
		L.push("BEGIN:VEVENT", `UID:tache-${esc(t.id)}@appli-ensam`, `DTSTAMP:${now}`);
		const timed = t.echeance.length > 10;
		if (timed) {
			const s = new Date(t.echeance);
			L.push(`DTSTART:${utcStamp(s)}`, `DTEND:${utcStamp(new Date(s.getTime() + 30 * 60e3))}`);
		} else {
			const d = dateOnly(t.echeance);
			L.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${nextDay(d)}`);
		}
		L.push(`SUMMARY:${esc("📝 " + t.titre + (t.matiere ? ` (${t.matiere})` : ""))}`);
		if (t.note) L.push(`DESCRIPTION:${esc(t.note)}`);
		L.push("TRANSP:TRANSPARENT");
		if (timed) L.push(...alarm("-PT1H", `À rendre dans 1 h : ${t.titre}`));
		else L.push(...alarm("-PT6H", `Pour demain : ${t.titre}`)); // la veille à 18 h
		L.push("END:VEVENT");
	}
	L.push("END:VCALENDAR");
	return L.map(fold).join("\r\n") + "\r\n";
}

// Lise ne renvoie que les semaines à venir : on garde les cours déjà passés
// (ceux qui commencent avant le premier cours renvoyé par Lise) pour ne pas perdre l'historique.
export function fusionPasse(anciens, fresh) {
	if (!fresh.length) return anciens;
	const debutLise = fresh.reduce((m, e) => (e.debut < m ? e.debut : m), fresh[0].debut);
	const uids = new Set(fresh.map((e) => e.uid));
	const passes = (anciens || []).filter((e) => e.debut < debutLise && !uids.has(e.uid));
	return [...passes, ...fresh].sort((a, b) => a.debut.localeCompare(b.debut));
}

// ---------- Planning du site Lise (plus à jour que le lien iCal) ----------
// notes.mjs enregistre dans planning-web.json les cours de l'agenda du site (connexion avec le mot de passe).
// Titre du site : « SALLE - début - fin - Module - Type - [activité - ] intervenants - durée - - groupes ».
const TYPES_WEB = "CM|ED_TD|TPS|TD|TP|TEST|EXAMEN|REUNION|PROJET|TRAVAIL_AUTONOME";
export function eventsDepuisSite(webEvents, ical) {
	const utilises = new Set();
	const out = [];
	for (const w of webEvents) {
		const debut = new Date(w.start).toISOString(), fin = new Date(w.end).toISOString();
		const m = w.title.match(new RegExp(`^(.*?) - (\\d\\d:\\d\\d) - (\\d\\d:\\d\\d) - (.+?) - (${TYPES_WEB}) - (.*?)(?: - (\\d+h\\d*))? - (.*)$`));
		const salle = m ? m[1].trim() : "";
		const module = m ? m[4].trim() : "";
		const typeRaw = (m ? m[5] : w.type) || "";
		const reste = m ? m[6] : "";
		const profs = reste.replace(/^\s*-\s*/, "").replace(/\s*-\s*$/, "").trim();
		const groupes = m ? (m[8].match(/FITE[^-]*|FIP[^-]*/)?.[0] || "").trim() : "";
		const libre = (e) => !utilises.has(e.uid) && (!module || e.module === module);
		const exact = ical.find((e) => libre(e) && e.debut === debut && e.fin === fin);
		if (exact) { utilises.add(exact.uid); out.push(exact); continue; }
		// Même module le même jour mais horaire corrigé sur le site : on garde l'identifiant (les partiels Lise y sont attachés)
		const proche = ical.filter((e) => libre(e) && e.debut.slice(0, 10) === debut.slice(0, 10) && e.type === (TYPE_LABELS[typeRaw] || typeRaw))
			.sort((a, b) => Math.abs(Date.parse(a.debut) - Date.parse(debut)) - Math.abs(Date.parse(b.debut) - Date.parse(debut)))[0];
		if (proche) { utilises.add(proche.uid); out.push({ ...proche, debut, fin, salle: salle || proche.salle, profs: profs || proche.profs }); continue; }
		const titre = module || "Cours";
		const examen = typeRaw === "EXAMEN" || typeRaw === "TEST" || /\b(partiel|examen|contr[ôo]le|interro)\b/i.test(titre);
		out.push({ uid: `web-${debut}-${titre}`.replace(/\s+/g, "_"), titre, module, code: "", type: TYPE_LABELS[typeRaw] || typeRaw, examen, debut, fin, journee: false, salle, profs, groupes });
	}
	return out.sort((a, b) => a.debut.localeCompare(b.debut));
}
// Le lien iCal reste la base. Le planning du site n'est qu'un point de comparaison : les écarts sont écrits dans
// ecarts.json (pour la notification) et ne sont appliqués que si Ewen les a acceptés (decisions.json → appliques).
const cleCours = (e) => `${e.debut}|${e.fin}`;
export function comparerPlanning(base, site, maintenant = Date.now()) {
	if (!site.length) return [];
	const lo = site[0].debut, hi = site.reduce((m, e) => (e.fin > m ? e.fin : m), site[0].fin);
	const debutAuj = new Date(maintenant - 86400e3).toISOString();
	const dansLaPeriode = (e) => e.fin > lo && e.debut < hi && e.debut >= debutAuj;
	const b = base.filter(dansLaPeriode);
	const sBon = site.filter((e) => e.debut >= debutAuj);
	const utilises = new Set();
	const ecarts = [];
	for (const w of sBon) {
		const meme = b.find((e) => !utilises.has(e.uid) && cleCours(e) === cleCours(w) && e.uid === w.uid);
		if (meme) { utilises.add(meme.uid); if ((meme.salle || "") !== (w.salle || "") && w.salle) ecarts.push({ type: "salle", uid: meme.uid, avant: meme, apres: { ...meme, salle: w.salle } }); continue; }
		const decale = b.find((e) => !utilises.has(e.uid) && e.uid === w.uid);
		if (decale) { utilises.add(decale.uid); ecarts.push({ type: "horaire", uid: decale.uid, avant: decale, apres: w }); continue; }
		ecarts.push({ type: "ajout", uid: w.uid, apres: w });
	}
	for (const e of b) if (!utilises.has(e.uid)) ecarts.push({ type: "suppression", uid: e.uid, avant: e });
	const hhmm = (iso) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
	const hh = (iso) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
	return ecarts.map((x) => {
		const ref = x.apres || x.avant;
		const id = `${x.type}:${x.uid}:${(x.apres || x.avant).debut}:${x.apres ? x.apres.fin : ""}:${x.apres?.salle || ""}`;
		const resume = { ajout: () => `Ajout sur le site : ${ref.titre} (${ref.type}) ${hhmm(ref.debut)}${ref.salle ? ", " + ref.salle : ""}`,
			suppression: () => `Absent du site : ${ref.titre} (${ref.type}) ${hhmm(ref.debut)}`,
			horaire: () => `Horaire différent : ${ref.titre} — lien ${hhmm(x.avant?.debut)}–${hh(x.avant?.fin)} → site ${hhmm(x.apres?.debut)}–${hh(x.apres?.fin)}`,
			salle: () => `Salle différente : ${ref.titre} ${hhmm(ref.debut)} — ${x.avant?.salle || "?"} → ${x.apres?.salle}` }[x.type]();
		return { id, type: x.type, resume, ...(x.avant ? { avant: x.avant } : {}), ...(x.apres ? { apres: x.apres } : {}) };
	});
}
export function appliquerEcarts(events, ecarts, appliques) {
	let out = events.slice();
	for (const x of ecarts.filter((e) => appliques.includes(e.id))) {
		if (x.type === "suppression") out = out.filter((e) => e.uid !== x.avant.uid);
		else if (x.type === "ajout") out.push(x.apres);
		else out = out.map((e) => (e.uid === x.avant.uid ? x.apres : e));
	}
	return out.sort((a, b) => a.debut.localeCompare(b.debut));
}


// ---------- Choix iCal / Lise (mêmes règles que l'agenda de l'appli, ecarts-choix.js) ----------
//  - écart d'horaire : version choisie (choix.json → versions : "ics" | "lise") ; sans choix ni décision : les deux, marquées ❓ ;
//  - cours qui se chevauchent entre le lien iCal et le site (uid « web-… ») : seul le cours retenu (choix.json → effectifs) ;
//    sans choix : tous, marqués ❓.
export function appliquerChoix(events, ecarts, choix, decisions) {
	const versions = choix?.versions || {}, retenus = new Set(choix?.effectifs || []);
	const decides = new Set([...(decisions?.appliques || []), ...(decisions?.ignores || [])]);
	const doute = (e) => ({ ...e, doute: true });
	let out = events.slice();
	for (const x of ecarts || []) {
		if (x.type !== "horaire" || !x.avant || !x.apres) continue;
		const uid = String(x.avant.uid), cote = versions[x.id];
		if (!cote && decides.has(x.id)) continue;
		out = out.filter((e) => String(e.uid) !== uid);
		if (cote === "ics") out.push(x.avant);
		else if (cote === "lise") out.push(x.apres);
		else out.push(doute(x.avant), doute({ ...x.apres, uid: uid + "-site" }));
	}
	out.sort((a, b) => a.debut.localeCompare(b.debut));
	const estWeb = (e) => String(e.uid).startsWith("web-");
	const groupes = [];
	let g = null, fin = "";
	for (const e of out.filter((e) => !e.journee)) {
		if (g && e.debut < fin) { g.push(e); if (e.fin > fin) fin = e.fin; }
		else { g = [e]; groupes.push(g); fin = e.fin; }
	}
	const exclus = new Set(), douteux = new Set();
	for (const gr of groupes) {
		if (gr.length < 2 || !gr.some(estWeb) || !gr.some((e) => !estWeb(e))) continue;
		if (gr.some((e) => retenus.has(String(e.uid)))) { for (const e of gr) if (!retenus.has(String(e.uid))) exclus.add(e.uid); }
		else for (const e of gr) douteux.add(e.uid);
	}
	return out.filter((e) => !exclus.has(e.uid)).map((e) => (douteux.has(e.uid) ? doute(e) : e));
}

// Pour un camarade (personne pour trancher dans l'appli) : le site Lise est le plus à jour,
// on prend ses ajouts et ses horaires ; un cours absent du site est gardé mais marqué ❓.
export function appliquerSiteAuto(events, ecarts) {
	let out = events.slice();
	for (const x of ecarts || []) {
		if (x.type === "ajout") out.push(x.apres);
		else if (x.type === "horaire" || x.type === "salle") out = out.map((e) => (e.uid === x.avant.uid ? x.apres : e));
		else if (x.type === "suppression") out = out.map((e) => (e.uid === x.avant.uid ? { ...e, doute: true } : e));
	}
	return out.sort((a, b) => a.debut.localeCompare(b.debut));
}

// ---------- Synchro d'un emploi du temps (le tien ou celui d'un camarade) ----------
// dossier : "" pour toi (fichiers à la racine du dépôt de données), "groupes/<id>/" pour un camarade.
async function synchroniser({ liseId, dossier = "", principal = false }) {
	const prev = await readJson(dossier + "events.json", { data: { events: [] } });
	let events = prev.data.events || [];
	let ecarts = (await readJson(dossier + "ecarts.json", { data: { ecarts: [] } })).data?.ecarts || [];
	let etat = { ok: true, message: "Synchronisé avec Lise" };
	let base = events;
	try {
		const raw = parseIcs(await fetchLise(liseId));
		const fresh = normaliseLise(raw);
		if (fresh.length === 0 && events.length > 0) {
			etat = { ok: false, message: "Lise a renvoyé un calendrier vide : ancienne version conservée" };
		} else {
			events = fusionPasse(principal ? events : (prev.data.base || []), fresh);
			base = events;
			const web = (await readJson(dossier + "planning-web.json", { data: null })).data;
			if (web?.events?.length && Date.now() - Date.parse(web.majLe) < 24 * 3600e3) {
				const site = eventsDepuisSite(web.events, fresh);
				ecarts = comparerPlanning(events, site);
				const prevEc = await readJson(dossier + "ecarts.json", { data: null });
				if (!prevEc.data || prevEc.data.ecarts.map((x) => x.id).join() !== ecarts.map((x) => x.id).join())
					await writeJson(dossier + "ecarts.json", { majLe: new Date().toISOString(), sourceMajLe: web.majLe, ecarts }, prevEc.sha, `Planning ${dossier || ""}: ${ecarts.length} écart(s) avec le site Lise`);
				if (principal) {
					const dec = (await readJson("decisions.json", { data: { appliques: [], ignores: [] } })).data;
					events = appliquerEcarts(events, ecarts, dec.appliques || []);
				} else events = appliquerSiteAuto(events, ecarts);
			} else if (!principal) ecarts = [];
		}
	} catch (err) {
		etat = { ok: false, message: `Lise injoignable (${err.message}) : ancienne version conservée` };
		console.log(`::warning title=Lise ${dossier || "(toi)"}::${etat.message}`);
	}
	const same = JSON.stringify(events) === JSON.stringify(prev.data.events || []);
	const payload = { majLe: new Date().toISOString(), etat, events, ...(principal ? {} : { base }) };
	const age = prev.data.majLe ? Date.now() - Date.parse(prev.data.majLe) : Infinity;
	if (TOKEN && (!same || age > 6 * 3600e3 || prev.data.etat?.ok !== etat.ok))
		await writeJson(dossier + "events.json", payload, prev.sha, same ? `Synchro Lise ${dossier}(vérification)` : `Synchro Lise ${dossier}: planning mis à jour`);
	return { events, ecarts, etat };
}

// ---------- Programme principal ----------
// Les liens .ics sont faits pour être partagés : cours Lise (avec tes choix iCal / Lise) et partiels, JAMAIS les tâches.
async function main() {
	if (!TOKEN && !LOCAL_ICS) throw new Error("Secret DATA_TOKEN manquant");
	const config = (await readJson("config.json", { data: {} })).data;
	if (!config.liseId && !LOCAL_ICS) throw new Error("liseId absent de config.json");
	if (!config.icsName) throw new Error("icsName absent de config.json");
	await mkdir(`${OUT_DIR}/cal`, { recursive: true });

	// Ton emploi du temps
	const partiels = (await readJson("partiels.json", { data: [] })).data;
	const moi = await synchroniser({ liseId: config.liseId, principal: true });
	const choix = (await readJson("choix.json", { data: { effectifs: [], versions: {} } })).data;
	const decisions = (await readJson("decisions.json", { data: { appliques: [], ignores: [] } })).data;
	const mesCours = appliquerChoix(moi.events, moi.ecarts, choix, decisions);
	const partielsPartages = partiels.map(({ description, note, ...p }) => p); // sans tes notes personnelles
	await writeFile(`${OUT_DIR}/cal/${config.icsName}.ics`, buildIcs({ events: mesCours, tasks: [], partiels: partielsPartages, nom: config.nomCalendrier || `ENSAM ${config.groupe || ""}`.trim() }));
	// Copies pour Netlify (adresses lisibles) : groupe2.ics = toi, groupe1.ics = camarade
	await mkdir("netlify-out", { recursive: true });
	await writeFile("netlify-out/_headers", "/*.ics\n  Content-Type: text/calendar; charset=utf-8\n  Cache-Control: no-cache\n  Access-Control-Allow-Origin: *\n");
	await writeFile(`netlify-out/${config.netlifyMoi || "groupe2"}.ics`, buildIcs({ events: mesCours, tasks: [], partiels: partielsPartages, nom: "ENSAM groupe 2" }));
	console.log(`OK : ${mesCours.length} cours (${mesCours.filter((e) => e.doute).length} à confirmer), ${partiels.length} partiels, aucune tâche. ${moi.etat.message}`);

	// Camarades d'autres groupes (Réglages → Calendriers des groupes)
	for (const g of config.groupes || []) {
		if (!g.liseId || !g.icsName || !g.id) continue;
		const r = await synchroniser({ liseId: g.liseId, dossier: `groupes/${g.id}/` });
		const icsG = buildIcs({ events: r.events, tasks: [], partiels: [], nom: `ENSAM ${g.nom || g.id}` });
		await writeFile(`${OUT_DIR}/cal/${g.icsName}.ics`, icsG);
		await writeFile(`netlify-out/${g.id === "g1" ? "groupe1" : g.id}.ics`, icsG);
		console.log(`Groupe ${g.nom || g.id} : ${r.events.length} cours (${r.events.filter((e) => e.doute).length} à confirmer). ${r.etat.message}`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		// Message lisible dans le résumé GitHub Actions (aucun secret affiché)
		console.log(`::error title=Synchro::${String(err.message).replace(/\n/g, " ")}`);
		process.exit(1);
	});
}
