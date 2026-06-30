var p=Object.defineProperty;var y=(n,t,e)=>t in n?p(n,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):n[t]=e;var R=(n,t,e)=>y(n,typeof t!="symbol"?t+"":t,e);import{r as d,j as r}from"./index-B3mMxBfE.js";async function L(n,t){var a;return(a=(await n.query("SELECT value FROM app_meta WHERE key = ?;",[t]))[0])==null?void 0:a.value}async function I(n,t,e){await n.exec("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",[t,e])}async function f(n){const t=await L(n,"device_id");if(t)return t;const e=crypto.randomUUID();return await I(n,"device_id",e),e}class C{constructor(){R(this,"worker");R(this,"nextId",1);R(this,"pending",new Map)}getWorker(){return this.worker?this.worker:(this.worker=new Worker(new URL("/helmdubo/assets/sqlite.worker-BOAYOZE0.js",import.meta.url),{type:"module"}),this.worker.onmessage=t=>{const e=this.pending.get(t.data.id);e&&(this.pending.delete(t.data.id),t.data.ok?e.resolve(t.data.result):e.reject(new Error(t.data.error)))},this.worker)}call(t){const e=this.nextId++,a={...t,id:e};return new Promise((i,u)=>{this.pending.set(e,{resolve:i,reject:u}),this.getWorker().postMessage(a)})}init(){return this.call({action:"init"})}async exec(t,e){await this.call({action:"exec",sql:t,params:e})}query(t,e){return this.call({action:"query",sql:t,params:e})}diagnostics(){return this.call({action:"diagnostics"})}async close(){this.worker&&(await this.call({action:"close"}),this.worker.terminate(),this.worker=void 0)}}function D(){return typeof crossOriginIsolated=="boolean"&&crossOriginIsolated}function x(){return typeof navigator<"u"&&"storage"in navigator&&typeof navigator.storage.getDirectory=="function"}class m{constructor(t=new C){R(this,"initialized",!1);this.transport=t}async init(){await this.transport.init(),this.initialized=!0}exec(t,e){return this.transport.exec(t,e)}query(t,e){return this.transport.query(t,e)}async transaction(t){await this.transport.exec("BEGIN;");const e={exec:(a,i)=>this.transport.exec(a,i),query:(a,i)=>this.transport.query(a,i)};try{const a=await t(e);return await this.transport.exec("COMMIT;"),a}catch(a){throw await this.transport.exec("ROLLBACK;"),a}}async diagnostics(){const t=await this.transport.diagnostics();return{initialized:this.initialized,persistenceMode:"opfs",opfsAvailable:x(),isCrossOriginIsolated:D(),foreignKeysEnabled:t.foreignKeysEnabled,sqliteVersion:t.sqliteVersion}}async close(){await this.transport.close(),this.initialized=!1}}const U=`CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  markdown    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS note_revisions (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  markdown   TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  deadline    INTEGER,
  urgency     TEXT CHECK (urgency IS NULL OR urgency IN ('urgent', 'normal')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_refs (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (task_id, note_id)
);

CREATE TABLE IF NOT EXISTS subtasks (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  sort_order  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS note_links (
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  raw_target     TEXT NOT NULL,
  link_type      TEXT NOT NULL DEFAULT 'wiki' CHECK (link_type IN ('wiki', 'suggested')),
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (source_note_id, raw_target)
);

CREATE INDEX IF NOT EXISTS idx_task_refs_note   ON task_refs(note_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task    ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_note_links_src   ON note_links(source_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_tgt   ON note_links(target_note_id);
`,F="1";async function X(n){await n.exec(U),await I(n,"schema_version",F),await f(n)}function k(n){return{id:n.id,title:n.title,markdown:n.markdown,createdAt:n.created_at,updatedAt:n.updated_at}}class v{constructor(t){this.conn=t}async create(t){const e=Date.now(),a=t.title??null;return await this.conn.exec("INSERT INTO notes (id, title, markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",[t.id,a,t.markdown,e,e]),{id:t.id,title:a,markdown:t.markdown,createdAt:e,updatedAt:e}}async get(t){const e=await this.conn.query("SELECT * FROM notes WHERE id = ?;",[t]);return e[0]?k(e[0]):void 0}async list(){return(await this.conn.query("SELECT * FROM notes ORDER BY updated_at DESC;")).map(k)}async update(t,e){const a=await this.get(t);if(!a)throw new Error(`NoteRepo.update: note not found: ${t}`);const i=e.title!==void 0?e.title:a.title,u=e.markdown!==void 0?e.markdown:a.markdown,w=Date.now();return await this.conn.exec("UPDATE notes SET title = ?, markdown = ?, updated_at = ? WHERE id = ?;",[i,u,w,t]),{...a,title:i,markdown:u,updatedAt:w}}async delete(t){await this.conn.exec("DELETE FROM notes WHERE id = ?;",[t])}async saveRevision(t,e){const a=await this.get(t);if(!a)throw new Error(`NoteRepo.saveRevision: note not found: ${t}`);await this.conn.exec("INSERT INTO note_revisions (id, note_id, markdown, reason, created_at) VALUES (?, ?, ?, ?, ?);",[crypto.randomUUID(),t,a.markdown,e,Date.now()])}}function b(n){return{id:n.id,title:n.title,status:n.status,deadline:n.deadline,urgency:n.urgency,createdAt:n.created_at,updatedAt:n.updated_at}}class M{constructor(t){this.conn=t}async createWithFirstRef(t,e){const a=crypto.randomUUID(),i=Date.now();return await this.conn.exec("INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?);",[a,e,i,i]),await this.conn.exec("INSERT INTO task_refs (task_id, note_id, created_at) VALUES (?, ?, ?);",[a,t,i]),{id:a,title:e,status:"open",deadline:null,urgency:null,createdAt:i,updatedAt:i}}async addRef(t,e){await this.conn.exec("INSERT OR IGNORE INTO task_refs (task_id, note_id, created_at) VALUES (?, ?, ?);",[t,e,Date.now()])}async removeRef(t,e){return await this.conn.exec("DELETE FROM task_refs WHERE task_id = ? AND note_id = ?;",[t,e]),this.getRefCount(t)}async getRefCount(t){var a;return((a=(await this.conn.query("SELECT COUNT(*) AS n FROM task_refs WHERE task_id = ?;",[t]))[0])==null?void 0:a.n)??0}async get(t){const e=await this.conn.query("SELECT * FROM tasks WHERE id = ?;",[t]);return e[0]?b(e[0]):void 0}async setTitle(t,e){await this.conn.exec("UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?;",[e,Date.now(),t])}async setStatus(t,e){await this.conn.exec("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?;",[e,Date.now(),t])}async delete(t){await this.conn.exec("DELETE FROM tasks WHERE id = ?;",[t])}}class W{constructor(t){this.conn=t}async upsertTag(t){const e=await this.conn.query("SELECT id, name FROM tags WHERE name = ?;",[t]);if(e[0])return e[0];const a={id:crypto.randomUUID(),name:t};return await this.conn.exec("INSERT INTO tags (id, name) VALUES (?, ?);",[a.id,a.name]),a}async bindTagToNote(t,e){await this.conn.exec("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?);",[t,e])}async unbindTagFromNote(t,e){await this.conn.exec("DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?;",[t,e])}async bindTagToTask(t,e){await this.conn.exec("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?);",[t,e])}async unbindTagFromTask(t,e){await this.conn.exec("DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?;",[t,e])}async clearNoteTags(t){await this.conn.exec("DELETE FROM note_tags WHERE note_id = ?;",[t])}async setNoteTags(t,e){await this.clearNoteTags(t);for(const a of e){const i=await this.upsertTag(a);await this.bindTagToNote(t,i.id)}}async clearNoteLinks(t){await this.conn.exec("DELETE FROM note_links WHERE source_note_id = ?;",[t])}async insertNoteLink(t){await this.conn.exec("INSERT OR IGNORE INTO note_links (source_note_id, target_note_id, raw_target, link_type, created_at) VALUES (?, ?, ?, ?, ?);",[t.sourceNoteId,t.targetNoteId??null,t.rawTarget,t.linkType??"wiki",Date.now()])}}let h=null;function N(){return h??(h=(async()=>{const n=new m;return await n.init(),await X(n),window.addEventListener("pagehide",()=>{n.close()}),{adapter:n,notes:new v(n),tasks:new M(n),tags:new W(n)}})()),h}async function O(){const{notes:n}=await N();return n.create({id:crypto.randomUUID(),title:`Debug note ${new Date().toLocaleTimeString()}`,markdown:`# Debug note

Created from the debug harness.`})}async function j(n){const{tasks:t}=await N();return t.createWithFirstRef(n,`Debug task ${new Date().toLocaleTimeString()}`)}async function Y(n,t){const{tasks:e}=await N();return await e.addRef(n,t),e.getRefCount(n)}async function H(n,t){const{tasks:e}=await N();return e.removeRef(n,t)}async function q(n){const{tags:t}=await N(),e=await t.upsertTag("debug-harness");return await t.bindTagToNote(n,e.id),await t.insertNoteLink({sourceNoteId:n,rawTarget:"Linked Note"}),e}function P(){const[n,t]=d.useState(null),[e,a]=d.useState({}),[i,u]=d.useState([]),[w,S]=d.useState(null),[A,g]=d.useState("initializing..."),c=d.useRef(null),E=d.useRef(null);async function _(){const{adapter:s,notes:o,tasks:T}=await N();t(await s.diagnostics()),a({schemaVersion:await L(s,"schema_version"),deviceId:await L(s,"device_id")}),u(await o.list()),S(E.current?{id:E.current,refCount:await T.getRefCount(E.current)}:null)}d.useEffect(()=>{_().then(()=>g("ready"))},[]);async function l(s,o){try{const T=await o();g(`${s}: ${JSON.stringify(T)}`)}catch(T){g(`${s} FAILED: ${T instanceof Error?T.message:String(T)}`)}await _()}return r.jsxs("section",{style:{marginTop:"2rem",borderTop:"1px solid #ccc",paddingTop:"1rem"},children:[r.jsx("h2",{children:"Debug storage harness"}),r.jsx("h3",{children:"Diagnostics"}),r.jsx("pre",{children:JSON.stringify(n,null,2)}),r.jsx("h3",{children:"app_meta"}),r.jsx("pre",{children:JSON.stringify(e,null,2)}),r.jsx("h3",{children:"Actions"}),r.jsx("button",{onClick:()=>void l("create note",async()=>{const s=await O();return c.current=s.id,s.id}),children:"Create note"}),r.jsx("button",{disabled:!c.current,onClick:()=>void l("create task with first ref",async()=>{const s=c.current;if(!s)return;const o=await j(s);return E.current=o.id,o.id}),children:"Create task with first ref (uses last note)"}),r.jsx("button",{disabled:!E.current,onClick:()=>void l("add ref (new note)",async()=>{const s=E.current;if(!s)return;const o=await O();return c.current=o.id,Y(s,o.id)}),children:"Add ref (creates a new note, refs last task)"}),r.jsx("button",{disabled:!E.current||!c.current,onClick:()=>void l("remove ref",async()=>{const s=E.current,o=c.current;if(!(!s||!o))return H(s,o)}),children:"Remove ref (last task, last note)"}),r.jsx("button",{disabled:!c.current,onClick:()=>void l("create tag + link",async()=>{const s=c.current;if(s)return q(s)}),children:"Create tag + link (on last note)"}),r.jsx("h3",{children:"Last action"}),r.jsx("pre",{children:A}),r.jsx("h3",{children:"Last task"}),r.jsx("pre",{children:JSON.stringify(w,null,2)}),r.jsxs("h3",{children:["Notes (",i.length,")"]}),r.jsx("pre",{children:JSON.stringify(i,null,2)})]})}export{P as DebugStorageHarness};
