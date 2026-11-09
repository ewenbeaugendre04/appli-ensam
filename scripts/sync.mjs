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
	const m = desc.match(new RegExp(`-\\s*${key}\\s*:\\s*(.+)`));
	return m ? m[1].trim() : "";
}

const TYPE_LABELS = { CM: "CM", ED_TD: "TD", TD: "TD", TPS: "TP", TP: "TP", TRAVAIL_AUTONOME: "Travail autonome", PROJET: "Projet", EXAMEN: "Examen" };

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
		const titre = summary || module || "Cours";
		const examen = typeRaw === "EXAMEN" || /\b(partiel|examen|ds|contr[ôo]le|interro)\b/i.test(titre);
		out.push({
			uid: e.UID ? e.UID.value : `${start.date.toISOString()}-${titre}`,
			titre,
			module,
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
	for (const base of ["https://lise.ensam.eu/ical_apprenant/", "http://lise.ensam.eu/ical_apprenant/"]) {
		try {
			const res = await fetch(base + encodeURIComponent(liseId), { headers: { "cache-control": "no-cache" } });
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
		"REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
	];
	for (const e of events) {
		const desc = [e.type && `Type : ${e.type}`, e.module && `Module : ${e.module}`, e.profs && `Intervenants : ${e.profs}`, e.groupes && `Groupes : ${e.groupes}`].filter(Boolean).join("\n");
		L.push("BEGIN:VEVENT", `UID:lise-${esc(e.uid)}`, `DTSTAMP:${now}`);
		if (e.journee) L.push(`DTSTART;VALUE=DATE:${dateOnly(e.debut)}`, `DTEND;VALUE=DATE:${dateOnly(e.fin)}`);
		else L.push(`DTSTART:${utcStamp(e.debut)}`, `DTEND:${utcStamp(e.fin)}`);
		L.push(`SUMMARY:${esc((e.examen ? "🎓 " : "") + (e.type ? `${e.type} · ` : "") + e.titre)}`);
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
		if (p.note) L.push(`DESCRIPTION:${esc(p.note)}`);
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

// ---------- Programme principal ----------
async function main() {
	if (!TOKEN && !LOCAL_ICS) throw new Error("Secret DATA_TOKEN manquant");
	const cfg = await readJson("config.json", { data: {} });
	const config = cfg.data;
	if (!config.liseId && !LOCAL_ICS) throw new Error("liseId absent de config.json");
	if (!config.icsName) throw new Error("icsName absent de config.json");

	const tasks = (await readJson("tasks.json", { data: [] })).data;
	const partiels = (await readJson("partiels.json", { data: [] })).data;
	const prev = await readJson("events.json", { data: { events: [] } });

	let events = prev.data.events || [];
	let etat = { ok: true, message: "Synchronisé avec Lise" };
	try {
		const fresh = normaliseLise(parseIcs(await fetchLise(config.liseId)));
		if (fresh.length === 0 && events.length > 0) {
			etat = { ok: false, message: "Lise a renvoyé un calendrier vide : ancienne version conservée" };
		} else events = fresh;
	} catch (err) {
		etat = { ok: false, message: `Lise injoignable (${err.message}) : ancienne version conservée` };
		console.log(`::warning title=Lise::${etat.message}`);
	}

	const same = JSON.stringify(events) === JSON.stringify(prev.data.events || []);
	const payload = { majLe: new Date().toISOString(), etat, events };
	// Pour limiter les commits : on n'écrit que si le planning a changé, ou au plus toutes les 6 h
	const age = prev.data.majLe ? Date.now() - Date.parse(prev.data.majLe) : Infinity;
	if (TOKEN && (!same || age > 6 * 3600e3 || prev.data.etat?.ok !== etat.ok)) {
		await writeJson("events.json", payload, prev.sha, same ? "Synchro Lise (vérification)" : "Synchro Lise : planning mis à jour");
	}

	const ics = buildIcs({ events, tasks, partiels, nom: config.nomCalendrier || "ENSAM" });
	await mkdir(`${OUT_DIR}/cal`, { recursive: true });
	await writeFile(`${OUT_DIR}/cal/${config.icsName}.ics`, ics);
	console.log(`OK : ${events.length} cours, ${tasks.filter((t) => !t.fait).length} tâches, ${partiels.length} partiels. ${etat.message}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		// Message lisible dans le résumé GitHub Actions (aucun secret affiché)
		console.log(`::error title=Synchro::${String(err.message).replace(/\n/g, " ")}`);
		process.exit(1);
	});
}
