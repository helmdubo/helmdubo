# PKM App — Orchestrator Brief v3 / Worker-Ready M0

Самодостаточный бриф для оркестратора и воркеров. Читающий инстанс не имеет доступа к предыдущему обсуждению — весь нужный контекст здесь.

Архитектурные решения зафиксированы владельцем продукта. Воркеры не пересматривают архитектуру, не добавляют sync/backend/AI/calendar/mobile packaging и не импровизируют за пределами этого документа.

Главная цель M0: получить запускаемый из браузера foundation приложения: Vite/React/TypeScript, SQLite WASM + OPFS, миграции, репозитории и debug-harness для ручной проверки данных.

---

## 0. Репозиторий и запуск

Проект живёт в отдельной папке репозитория:

```
repo/
  docs/
    pkm/
      orchestrator-brief-v3.md
      worker-tasks/
      decisions/
  pkm-app/
    package.json
    vite.config.ts
    src/
    spike/
```

Не класть приложение в корень репозитория. Корень может использоваться для документации, планов, будущего backend/sync/mobile packaging.

### Browser-run contract

Первые прогоны должны запускаться из браузера через Vite:

```
cd pkm-app
npm install
npm run dev -- --host 0.0.0.0
```

Открыть:

```
http://localhost:5173
```

Также должен работать production-preview:

```
npm run build
npm run preview -- --host 0.0.0.0
```

Важно: SQLite/OPFS-данные живут в браузерном хранилище origin'а. Контейнер, если используется, нужен только как dev-среда для Node/Vite. Само OPFS-хранилище будет в браузере пользователя, а не в файловой системе контейнера.

---

## 1. Что строим

Персональное приложение знаний: заметки + теги + связи/граф + задачи.

Продуктовая ставка:

> низкий порог входа + эмерджентная структура

Пользователь пишет как в обычный блокнот. Структура проявляется постепенно через теги, связи, задачи, backlinks, граф и later semantic suggestions.

Платформы v1:

Web/PWA first.
Android через Capacitor позже.
iOS / native desktop позже.

Текущий план M0–M4 не включает Android packaging, iOS, Tauri, sync, backend, embeddings, Google Calendar.

---

## 2. Роли и процесс

### Роли

- Orchestrator-Architect-Reviewer — режет milestone'ы на worker-задачи
- Worker — делает одну маленькую задачу

### Размер worker-задачи

Обычная feature-задача:

- ≤6 файлов
- ≤7 критериев приёмки
- можно зачитать вслух за 30 секунд

Для инфраструктурных задач допустимо до 8 файлов, если это прямо указано в задаче. Воркеры не должны расширять scope ради удобства.

### Правило эскалации

Если worker упирается в решение вне §2–§5, он останавливается и эскалирует Architect'у. Не импровизировать с архитектурой.

---

## 3. Архитектурные решения

### 3.1 Stack

- Vite
- TypeScript strict
- React 18
- CodeMirror 6
- Vitest для unit tests
- Playwright позже для browser/E2E, но OPFS-spike может использовать Playwright раньше
- SQLite WASM + OPFS

### 3.2 Редактор

Редактор — CodeMirror 6.

Задачные якоря вида `^task-<id>`:

- скрываются decoration/widget-слоем;
- защищаются atomic range;
- не доступны для посимвольного редактирования;
- удаление/преобразование ref-строки — domain action, а не случайная правка текста.

Для M2 обязательно использовать не только decorations, но и защитный механизм уровня editor transaction/change filter, чтобы paste/delete/undo не ломали `^task-id`.

### 3.3 Двухслойная модель данных

```
Проза заметки:
  notes.markdown — канонический источник истины.
Структурные объекты:
  tasks, subtasks, task status, deadline, urgency, task tags — каноничны в БД.
Индексы:
  task_refs, note_tags, task_tags, note_links — производные индексы из markdown.
```

### 3.4 Storage

Весь доступ к данным идёт через `StorageAdapter`.

Запрещено:

- UI напрямую импортирует sqlite
- domain layer напрямую импортирует sqlite
- repository зависит от `SqliteWasmOpfsAdapter` вместо интерфейса

Разрешено:

- `StorageAdapter`
- `StorageTransaction`
- repositories поверх `StorageAdapter`

Единственная реализация v1:

> SQLite WASM + OPFS

Native SQLite, Capacitor storage, sync/backend adapters — later.

### 3.5 Нет серверного кода

M0–M4 полностью локальные. Никакого backend, auth, sync, embeddings API, Google Calendar.

---

## 4. Модель данных

### 4.1 Источник истины

| Данные | Источник истины | Производное |
|---|---|---|
| Проза заметки | `notes.markdown` | — |
| Факт наличия ref задачи в заметке | markdown-якорь `^task-id` | `task_refs` |
| Заголовок задачи | `tasks.title` | title в ref-строке |
| Статус задачи | `tasks.status` | `[ ]` / `[x]` в ref-строке |
| Deadline / urgency | `tasks.deadline`, `tasks.urgency` | views hot/cold |
| Подзадачи | `subtasks` | widget/panel UI |
| Теги заметки | `#tag` в markdown | `note_tags` |
| Теги задачи | `#tag` в task-ref строке | `task_tags` |
| Wiki-ссылки | `[[Название]]` в markdown | `note_links` |
| Backlinks | `note_links` | derived view |

Правила:

- `task_refs`, `note_links`, `note_tags`, `task_tags` можно сбросить и пересобрать из `notes.markdown`.
- Логика приложения никогда не считает эти таблицы авторитетнее markdown.
- Task object авторитетен для title/status/deadline/urgency/subtasks.

### 4.2 TaskRef

Ref-строка:

```
- [ ] Позвонить бухгалтеру #armenia ^task-<id>
```

Done:

```
- [x] Позвонить бухгалтеру #armenia ^task-<id>
```

Правила:

- `^task-id` уникален внутри заметки.
- Максимум один ref на пару `(task_id, note_id)`.
- `task_refs` имеет `PRIMARY KEY (task_id, note_id)`.

Если в одной заметке найден повторный `^task-id`, первый ref считается валидным, остальные трактуются как обычный markdown и не создают `task_refs`.

### 4.3 Title и inline-теги в task-ref строке

В task-ref строке:

```
- [ ] Позвонить бухгалтеру #armenia ^task-123
```

`tasks.title`:

```
Позвонить бухгалтеру
```

`#armenia` не входит в title. Он становится `task_tag`.

При render/reconcile ref-строки приложение собирает строку из:

- checkbox status
- `tasks.title`
- inline task tags
- `^task-id`

### 4.4 Подзадачи

В M2 подзадач нет.

В M2.5 подзадачи добавляются только через панель/виджет задачи.

Вложенные markdown-чекбоксы под ref-строкой в v1 остаются обычным markdown и не становятся object-subtasks автоматически.

Запрещённый default:

> Пользователь печатает вложенный чекбокс → он автоматически становится subtask.

Если в будущем нужен такой путь, потребуется отдельная архитектура с `^subtask-id`.

### 4.5 Схема SQLite

Схема заводится целиком в M0, чтобы позже не плодить ранние миграции.

```sql
-- foreign_keys ОБЯЗАТЕЛЬНО включать на каждом соединении:
-- PRAGMA foreign_keys=ON;
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  markdown    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE note_revisions (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  markdown   TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  deadline    INTEGER,
  urgency     TEXT CHECK (urgency IS NULL OR urgency IN ('urgent', 'normal')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE task_refs (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (task_id, note_id)
);
CREATE TABLE subtasks (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  sort_order  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);
CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE TABLE note_links (
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  raw_target     TEXT NOT NULL,
  link_type      TEXT NOT NULL DEFAULT 'wiki' CHECK (link_type IN ('wiki', 'suggested')),
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (source_note_id, raw_target)
);
CREATE INDEX idx_task_refs_note   ON task_refs(note_id);
CREATE INDEX idx_subtasks_task    ON subtasks(task_id);
CREATE INDEX idx_note_links_src   ON note_links(source_note_id);
CREATE INDEX idx_note_links_tgt   ON note_links(target_note_id);
```

### 4.6 Derived index timestamps

`created_at` в derived indexes (`task_refs`, `note_links`) — это время создания индексной строки, а не семантическое время первого появления связи.

Запрещено использовать эти timestamps для будущей sync-логики или аналитики без отдельного решения Architect'а.

---

## 5. Parser / Reconciler contract

Функция:

```ts
rebuildNoteDerivedIndex(noteId: string): Promise<void>
```

Делает:

- читает `notes.markdown`
- парсит task anchors, tags, wiki-links
- очищает derived indexes для `noteId`
- пересобирает `task_refs`, `note_tags`, `note_links`
- дополнительно обновляет `task_tags` для task-ref строк

### 5.1 Tags

- `#tag` в любом месте заметки → note_tag
- `#tag` в строке task-ref → дополнительно task_tag
- кириллица разрешена
- `#a/b` разрешён как единое имя тега
- внутри fenced code block игнорируется
- внутри inline code игнорируется
- наследования тегов заметки задачей нет

### 5.2 Wiki links

```
[[Название]]
```

Создаёт:

- `note_links.source_note_id` = текущая заметка
- `note_links.raw_target` = "Название"
- `note_links.link_type` = "wiki"

Если существует заметка с таким title, проставить `target_note_id`.

Если нет, `target_note_id` = NULL — frontier link.

Внутри code blocks и inline code игнорировать.

`note_links` хранит уникальные edges, не occurrences. Несколько одинаковых `[[Название]]` в одной заметке создают одну строку.

### 5.3 Task anchors

```
^task-<id>
```

Если объект `tasks.id` существует:

- создать `task_refs(task_id, note_id)`

Если task отсутствует:

- `task_refs` не создавать
- диагностический лог
- строку трактовать как обычный markdown

Дубликат task anchor в одной заметке:

- первый валиден
- остальные обычный markdown
- INV-6 не нарушать

---

## 6. Инварианты

Reviewer проверяет всегда.

- INV-1. Источник истины соблюдён по §4.1.
- INV-2. Derived indexes не авторитетнее markdown.
- INV-3. markdown не теряется; перед авто-rewrite пишется note_revisions.
- INV-4. Задача без ref'ов не существует; снятие последнего ref требует подтверждения и удаляет объект.
- INV-5. Доступ к данным только через StorageAdapter.
- INV-6. PRAGMA foreign_keys=ON установлен на каждом соединении.
- INV-7. Максимум один ref на (task_id, note_id).
- INV-8. Номера строк ref'ов не хранятся; при rewrite приложение парсит актуальный markdown.

---

## 7. StorageAdapter contract

### 7.1 Types

```ts
export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = readonly SqlValue[] | Record<string, SqlValue>;

export interface StorageConnection {
  exec(sql: string, params?: SqlParams): Promise<void>;
  query<T>(sql: string, params?: SqlParams): Promise<T[]>;
}

export interface StorageTransaction extends StorageConnection {}

export interface StorageDiagnostics {
  initialized: boolean;
  persistenceMode: 'opfs' | 'memory' | 'unknown';
  opfsAvailable: boolean;
  isCrossOriginIsolated: boolean;
  foreignKeysEnabled: boolean;
  sqliteVersion?: string;
}

export interface StorageAdapter extends StorageConnection {
  init(): Promise<void>;
  transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  diagnostics(): Promise<StorageDiagnostics>;
  close?(): Promise<void>;
}
```

### 7.2 Transaction rules

- `transaction(fn)` передаёт tx-объект.
- Внутри transaction репозитории используют tx, а не глобальный adapter.
- Если fn бросает исключение — ROLLBACK.
- Если fn завершается успешно — COMMIT.
- Nested transactions в M0 не поддерживать, если явно не реализовано.

---

## 8. UX contract M1–M4

### 8.1 Notes

- список заметок
- создание заметки
- открытие заметки
- редактирование markdown в CodeMirror 6
- ручное сохранение
- autosave позже внутри M1
- markdown — канонический текст

### 8.2 Обычные чекбоксы

```
- [ ] foo
```

Без `^task-id` — обычный markdown checkbox, не задача.

UX default:

- рендерится как обычный checkbox
- в пул задач не попадает
- есть hover/context action "Преобразовать в задачу"

### 8.3 Создание задачи

Пользователь выделяет строку/текст → "Создать задачу".

Результат:

```
- [ ] {title} ^task-<id>
```

Создаётся объект `tasks`.

Создаётся/пересобирается derived index `task_refs`.

### 8.4 Toggle done

Checkbox task-widget:

- open → done
- done → open

Markdown representation обновляется:

```
- [ ] ...
- [x] ...
```

UI done-задачи зачёркивает title.

### 8.5 Rename

Правка task title через ref/widget:

- обновляет `tasks.title`
- текущая ref-строка перерендеривается
- прочие ref-строки реконсилятся лениво при открытии/через rewrite operation

Правка title в пуле:

- обновляет `tasks.title`
- переписывает все ref-строки в заметках, где есть task_refs
- перед rewrite каждой заметки создаёт note_revision

### 8.6 Удаление

Три пути:

1. Стирание ref-widget в заметке.
2. "Удалить через ref" → ref-строка превращается в обычный текст.
3. "Удалить из пула" → все ref-строки во всех заметках превращаются в обычный текст.

Если снимается последний ref задачи:

- показать предупреждение: "Потеряете задачу «<title>»"

После подтверждения:

- удалить task object
- каскадом удаляются task_refs, subtasks, task_tags

Для delete-from-pool:

- перед rewrite каждой затронутой заметки создать `note_revision(reason='delete-from-pool')`

### 8.7 Subtasks M2.5

Default:

- создаются только через панель/виджет задачи
- не материализуются в markdown
- вложенные markdown-чекбоксы не становятся subtasks автоматически

Автозакрытие:

- все subtasks done → parent task done
- появилась новая/open subtask → parent task open

### 8.8 Hot/cold M4

Две независимые оси:

```
deadline:
  NULL = cold
  not NULL = hot
urgency:
  NULL | normal | urgent
```

v1 view:

```
cold / hot
```

Позже:

```
запланированность × приоритет
```

---

## 9. Roadmap

| Milestone | Содержание |
|---|---|
| M0.0 | Папка проекта, README, run contract |
| M0.1 | Vite/React/TS scaffold |
| M0.2 | Lint/test infra + COOP/COEP dev/preview |
| M0.3 | SQLite WASM + OPFS storage spike |
| M0.4 | StorageAdapter + SqliteWasmOpfsAdapter |
| M0.5 | Schema + migrations + app_meta |
| M0.6 | NoteRepo |
| M0.7 | TaskRepo без subtasks |
| M0.8 | TagRepo + note_links table ops |
| M0.9 | Debug storage harness |
| M1 | Notes UI + CodeMirror CRUD |
| M1.5a | Derived index parser/reconciler |
| M1.5b | Backlinks |
| M1.5c | Export markdown zip |
| M1.5d | DB backup export |
| M1.5e | Import, строго после отдельной спеки |
| M2 | Basic tasks: promote, widget, toggle, rename, deletion flows |
| M2.5 | Subtasks через panel/widget |
| M3 | Task pool / tag cloud |
| M4 | Hot/cold + deadline views |
| M5+ | sync / embeddings / Google Calendar / Android packaging / native SQLite |

---

## 10. M0 Worker Tasks

### T0.0 — Project folder + README

Цель: выделить проект в отдельную папку и зафиксировать команды запуска.

Файлы:

- `pkm-app/README.md`
- `docs/pkm/orchestrator-brief-v3.md`

Критерии приёмки:

1. Создана папка `pkm-app/`.
2. README.md описывает browser-run contract.
3. README содержит команды `npm install`, `npm run dev`, `npm run build`, `npm run preview`.
4. README объясняет, что OPFS-данные живут в браузере, а не в контейнере.
5. Бриф сохранён в `docs/pkm/orchestrator-brief-v3.md`.

---

### T0.1 — Vite/React/TypeScript scaffold

Цель: минимальный запускаемый frontend.

Файлы:

- `pkm-app/package.json`
- `pkm-app/vite.config.ts`
- `pkm-app/tsconfig.json`
- `pkm-app/index.html`
- `pkm-app/src/main.tsx`

Критерии приёмки:

1. `npm run dev` поднимает Vite.
2. В браузере отображается заглушка PKM.
3. React 18+.
4. TypeScript strict включён.
5. `npm run build` проходит.

---

### T0.2 — Lint/test infra + COOP/COEP

Цель: добавить базовую проверочную инфраструктуру и нужные headers.

Файлы:

- `pkm-app/package.json`
- `pkm-app/vite.config.ts`
- `pkm-app/eslint.config.js`
- `pkm-app/vitest.config.ts`
- `pkm-app/playwright.config.ts`
- `pkm-app/src/smoke.test.ts`

Критерии приёмки:

1. `npm run lint` проходит.
2. `npm run test` запускает Vitest и проходит smoke test.
3. Playwright добавлен как dev dependency и имеет stub config.
4. `vite.config.ts` задаёт COOP/COEP в `server.headers`.
5. `vite.config.ts` задаёт COOP/COEP в `preview.headers`.
6. `npm run build` и `npm run preview` работают.

---

### T0.3 — SQLite WASM + OPFS storage spike

Цель: снять риск OPFS до основной реализации.

Файлы:

- `pkm-app/spike/sqlite-opfs.ts`
- `pkm-app/spike/index.html`
- `pkm-app/spike/FINDINGS.md`
- `pkm-app/package.json`

Критерии приёмки:

1. В браузере есть spike-страница/entry, где можно выполнить write → reload → read.
2. Transaction rollback проверяется и проходит.
3. `PRAGMA foreign_keys=ON` проверяется.
4. `ON DELETE CASCADE` реально срабатывает в spike.
5. На странице выводятся diagnostics: `isCrossOriginIsolated`, `opfsAvailable`, `persistenceMode`.
6. FINDINGS.md фиксирует выбранный OPFS VFS path, dev/prod headers и известные ограничения.
7. Spike может быть throwaway, но findings обязательны.

---

### T0.4 — StorageAdapter + SqliteWasmOpfsAdapter

Цель: реализовать storage interface и единственную v1-реализацию.

Файлы:

- `pkm-app/src/storage/StorageAdapter.ts`
- `pkm-app/src/storage/SqliteWasmOpfsAdapter.ts`
- `pkm-app/src/storage/index.ts`
- `pkm-app/src/storage/SqliteWasmOpfsAdapter.test.ts`

Критерии приёмки:

1. Интерфейс соответствует §7.
2. SqliteWasmOpfsAdapter использует `@sqlite.org/sqlite-wasm` и OPFS.
3. `PRAGMA foreign_keys=ON` устанавливается при init.
4. `diagnostics()` возвращает поля из §7.
5. `transaction<T>(fn: tx => ...)` делает COMMIT/ROLLBACK.
6. UI/domain не импортируют sqlite напрямую.
7. Unit tests покрывают interface behavior; browser persistence полагается на T0.3 findings/spike.

---

### T0.5 — Schema + migrations + app_meta

Цель: создать всю схему §4.5 и migration runner.

Файлы:

- `pkm-app/src/db/schema.sql`
- `pkm-app/src/db/migrate.ts`
- `pkm-app/src/db/appMeta.ts`
- `pkm-app/src/db/migrate.test.ts`

Критерии приёмки:

1. `schema.sql` содержит всю схему §4.5.
2. Миграции идемпотентны.
3. `app_meta.schema_version` устанавливается и читается.
4. `app_meta.device_id` генерируется один раз и сохраняется.
5. Индексы созданы.
6. Тест проверяет `ON DELETE CASCADE` при включённых foreign keys.
7. Все операции идут через StorageAdapter.

---

### T0.6 — NoteRepo

Цель: репозиторий заметок.

Файлы:

- `pkm-app/src/db/repositories/NoteRepo.ts`
- `pkm-app/src/db/repositories/NoteRepo.test.ts`
- `pkm-app/src/db/repositories/index.ts`

Критерии приёмки:

1. create.
2. get.
3. update.
4. delete.
5. list.
6. updated_at обновляется при update.
7. saveRevision(noteId, reason) пишет в note_revisions.

---

### T0.7 — TaskRepo without subtasks

Цель: базовый репозиторий задач и refs, без subtasks.

Файлы:

- `pkm-app/src/db/repositories/TaskRepo.ts`
- `pkm-app/src/db/repositories/TaskRepo.test.ts`
- `pkm-app/src/db/repositories/index.ts`

Критерии приёмки:

1. createWithFirstRef(noteId, title).
2. addRef(taskId, noteId).
3. removeRef(taskId, noteId) возвращает новый refCount и сам объект не удаляет.
4. getRefCount(taskId).
5. setTitle(taskId, title).
6. setStatus(taskId, status).
7. delete(taskId) удаляет объект, refs/subtasks/task_tags каскадом.

---

### T0.8 — TagRepo + note_links table operations

Цель: операции тегов и note_links без markdown parsing.

Файлы:

- `pkm-app/src/db/repositories/TagRepo.ts`
- `pkm-app/src/db/repositories/TagRepo.test.ts`
- `pkm-app/src/db/repositories/index.ts`

Критерии приёмки:

1. upsertTag(name).
2. Bind/unbind tag to note.
3. Bind/unbind tag to task.
4. clearNoteTags(noteId) / setNoteTags(noteId, tagNames).
5. clearNoteLinks(noteId) / insertNoteLink(...).
6. Markdown parsing не реализуется в этой задаче.
7. Все методы работают через StorageAdapter.

---

### T0.9 — Debug storage harness

Цель: дать владельцу продукта первый ручной браузерный прогон.

Файлы:

- `pkm-app/src/dev/DebugStorageHarness.tsx`
- `pkm-app/src/dev/seed.ts`
- `pkm-app/src/App.tsx`
- `pkm-app/src/dev/devOnly.ts`

Критерии приёмки:

1. В dev mode доступен debug экран.
2. Показывает storage diagnostics.
3. Показывает app_meta.
4. Кнопки: create note, create task with first ref, add ref, remove ref, create tag/link.
5. После reload данные сохраняются.
6. Debug harness не попадает в production behavior.
7. Нет прямого sqlite import вне storage layer.

---

## 11. M1–M4 Outline

Точные PR-спеки для M1–M4 готовит Orchestrator после завершения M0.

### M1 — Notes

1. CM6 editor + load/save одной заметки.
2. Notes list + navigation + CRUD.
3. Manual save/autosave.

### M1.5 — Derived index + safety

1. Parser/rebuildNoteDerivedIndex.
2. Backlinks.
3. Export markdown zip.
4. DB backup export.
5. Import — только по отдельной спеки; default import never overwrites existing notes.

### M2 — Basic tasks

1. Promote selected line/text to task.
2. Task widget + hidden atomic anchor.
3. Toggle done/open.
4. Rename via ref/widget and via pool later.
5. Ref-count deletion flows + warnings.

### M2.5 — Subtasks

1. Subtasks repo.
2. Panel/widget add/edit/remove.
3. Parent auto-close/open.

### M3 — Task pool / tag cloud

1. List task objects.
2. Filter by tag.
3. Edit panel writes object + rewrites refs with revisions.
4. Delete-from-pool rewrites refs to plain text with revisions.

### M4 — Hot/cold

1. Set/clear deadline.
2. Cold/hot view.
3. Sorting/grouping by deadline and urgency.

---

## 12. Definition of Done

Для каждой worker-задачи:

- критерии приёмки выполнены
- `npm run lint` чистый
- `npm run test` чистый
- `npm run build` чистый
- TypeScript strict без ошибок
- инварианты §6 не нарушены
- нет прямых sqlite imports вне storage
- не затронут отложенный scope

Reviewer checklist:

1. Источник истины соблюдён?
2. Derived indexes не используются как канон?
3. PRAGMA foreign_keys=ON реально включён?
4. markdown не теряется?
5. note_revisions пишутся перед auto-rewrite?
6. StorageAdapter boundary соблюдён?
7. TaskRef uniqueness соблюдена?
8. Нет line-number persistence?
9. Worker не полез в sync/backend/AI/calendar/mobile?
10. Задача не раздута сверх своих границ?

---

## 13. Отложенный scope

Запрещено в M0–M4:

- sync между устройствами
- backend
- auth
- server embeddings
- local embeddings
- semantic clusters
- Google Calendar
- Capacitor packaging
- Android native SQLite
- Tauri
- iOS
- collaboration
- CRDT

Если worker считает, что без этого не обойтись, он не реализует обходной путь, а эскалирует Architect'у.

---

## 14. Контейнер / devcontainer

Контейнер не обязателен для M0.

Допустимо позже добавить отдельной задачей:

> T0.x — Devcontainer

Но это не блокирует browser-run. Vite dev-server + браузерный OPFS-spike являются источником истины для проверки storage behavior.

Минимальный принцип:

- контейнер запускает Node/Vite
- браузер хранит OPFS
- данные OPFS не находятся в контейнере

---

## 15. Future Graph Projection / Interactive Knowledge Cloud

Этот раздел фиксирует будущую архитектурную границу для интерактивного облака заметок, тегов, связей и тем.

Важно: граф / облако / 3D-визуализация — это проекция данных, а не источник истины.

M0–M4 не реализуют Three.js/D3/3D-граф. Но код M0–M4 должен сохранять такую модель данных и такие границы слоёв, чтобы позднее можно было добавить интерактивное облако без переписывания core data model.

### 15.1 Product intent

В будущем приложение должно иметь отдельный режим исследования знаний:

> Interactive Knowledge Cloud

Пользователь видит облако заметок, тегов, задач и тем, где:

- заметки отображаются как точки;
- теги / темы / кластеры могут быть отдельными узлами или группирующими центрами;
- связанные заметки находятся ближе друг к другу;
- заметки одного кластера визуально группируются;
- цвет отражает cluster/topic/tag group;
- пользователь вращает, приближает и фильтрует облако;
- облако перестраивается при изменении фильтров;
- можно смотреть развитие знаний во времени через timeline-фильтр.

Примеры пользовательских сценариев:

1. Показать все заметки по теме "Армения / бизнес".
2. Скрыть все заметки, добавленные после 1 июня.
3. Показать только старые заметки до выбранной даты.
4. Показать только заметки, связанные с тегами #banks и #compliance.
5. Скрыть задачи и оставить только заметки + теги.
6. Показать только ручные wiki-связи, скрыв suggested-связи.
7. Выбрать кластер и увидеть все принадлежащие ему заметки.
8. Кликнуть по точке и открыть соответствующую заметку.
9. Сфокусироваться на заметке и увидеть её локальное окружение.

Граф — это не основной режим ввода. Основной режим остаётся простым блокнотом. Граф — режим исследования, навигации и понимания структуры.

### 15.2 Core principle: graph is a projection

Фундаментальное правило:

> Graph is a projection of canonical app data.
> Graph is never canonical data itself.

Граф строится из уже существующих источников:

- notes
- tasks
- tags
- note_links
- note_tags
- task_tags
- task_refs
- future semantic links
- future topic clusters

Графовый renderer не создаёт собственную правду о данных. Он не решает, какие заметки связаны, какие теги существуют, какие задачи принадлежат заметке и какие кластеры являются "настоящими".

Правильно:

```
canonical data
→ repositories
→ GraphProjectionService
→ GraphViewModel
→ layout engine
→ 2D/3D renderer
```

Неправильно:

```
Three.js component
→ directly reads SQLite
→ mutates tags/links/tasks
→ stores relationship facts inside renderer state
```

Renderer state может хранить только состояние отображения:

- camera position
- selected node
- hovered node
- active filters
- temporary layout positions
- pinned visual positions
- animation state

Renderer state не может быть источником истины для:

- note content
- tags
- tasks
- wiki links
- task refs
- topic membership
- semantic links
- deadlines
- statuses

### 15.3 What must be true after M0–M4

M0–M4 не реализуют графовый UI, но они обязаны не ломать будущий graph projection.

После M0–M4 должны существовать данные, из которых можно построить typed graph:

```
notes          → note nodes
tags           → tag nodes
tasks          → task nodes
note_links     → note-note edges
note_tags      → note-tag edges
task_refs      → note-task edges
task_tags      → task-tag edges
```

Уже в текущей схеме важно сохранить:

- notes.created_at
- notes.updated_at
- tasks.created_at
- tasks.updated_at
- tags.name
- note_links.link_type
- task status
- task deadline
- task urgency

Эти поля нужны для будущих timeline/filter/cluster views.

M0–M4 worker'ы не должны:

1. удалять note_links как "неиспользуемые сейчас";
2. делать task_refs авторитетнее markdown;
3. привязывать graph logic к UI-компонентам;
4. добавлять Three.js/D3 зависимости раньше отдельного graph milestone;
5. хранить line numbers как graph metadata;
6. использовать renderer state как источник истины;
7. писать graph-specific данные в core tables без отдельной спеки.

### 15.4 Future GraphProjectionService

В будущем должен появиться отдельный сервис:

> GraphProjectionService

Его задача — собрать canonical data и derived indexes в нейтральную graph-модель, не завязанную на Three.js, D3, React или конкретный renderer.

Пример интерфейса:

```ts
export interface GraphProjectionService {
  buildProjection(query: GraphProjectionQuery): Promise<GraphProjection>;
}
```

Projection query:

```ts
export interface GraphProjectionQuery {
  nodeTypes?: GraphNodeType[];
  edgeTypes?: GraphEdgeType[];
  time?: {
    mode: 'created' | 'updated';
    from?: number;
    to?: number;
  };
  tagIds?: string[];
  taskStatuses?: Array<'open' | 'done'>;
  hotCold?: 'hot' | 'cold' | 'all';
  clusterIds?: string[];
  includeSuggestedLinks?: boolean;
  focus?: {
    nodeId: string;
    depth: number;
  };
  limit?: number;
}
```

Projection result:

```ts
export interface GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  meta: GraphProjectionMeta;
}
```

Node:

```ts
export type GraphNodeType =
  | 'note'
  | 'tag'
  | 'task'
  | 'topic';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  title: string;
  createdAt?: number;
  updatedAt?: number;
  clusterId?: string;
  colorKey?: string;
  weight?: number;
  source: {
    table: 'notes' | 'tags' | 'tasks' | 'virtual';
    id: string;
  };
}
```

Edge:

```ts
export type GraphEdgeType =
  | 'wiki'
  | 'tag'
  | 'task-ref'
  | 'task-tag'
  | 'suggested'
  | 'cooccurrence';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  weight: number;
  sourceData?: {
    table: 'note_links' | 'note_tags' | 'task_refs' | 'task_tags' | 'virtual';
    id?: string;
  };
}
```

Cluster:

```ts
export interface GraphCluster {
  id: string;
  title: string;
  type: 'tag' | 'tag-group' | 'topic' | 'semantic';
  colorKey: string;
  nodeIds: string[];
  weight?: number;
}
```

Meta:

```ts
export interface GraphProjectionMeta {
  generatedAt: number;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  filtersApplied: string[];
}
```

### 15.5 Current data → future graph mapping

The first implementation of GraphProjectionService should be able to map current data as follows:

Notes

```
notes.id        → GraphNode.id = "note:<id>"
notes.title     → GraphNode.title
notes.created_at → GraphNode.createdAt
notes.updated_at → GraphNode.updatedAt
```

Tags

```
tags.id     → GraphNode.id = "tag:<id>"
tags.name   → GraphNode.title
```

Tasks

```
tasks.id       → GraphNode.id = "task:<id>"
tasks.title    → GraphNode.title
tasks.status   → node metadata / filter field
tasks.deadline → hot/cold filter
tasks.urgency  → priority filter
```

Wiki links

```
note_links
source_note_id → source = "note:<source_note_id>"
target_note_id → target = "note:<target_note_id>"
link_type='wiki' → edge.type = 'wiki'
link_type='suggested' → edge.type = 'suggested'
```

If `target_note_id = NULL`, the future graph may optionally show a frontier node:

```
frontier:<raw_target>
```

But this is a renderer/view decision, not canonical data.

Tags

```
note_tags → edge.type = 'tag'
task_tags → edge.type = 'task-tag'
```

Task refs

```
task_refs → edge.type = 'task-ref'
```

### 15.6 Clusters and colors

Clusters are also projections.

In v1/future graph MVP, cluster can be derived from tags:

> tag cluster = notes/tasks sharing the same tag

Later, semantic clustering can add:

- topic cluster
- semantic cluster
- suggested relation cluster

But semantic clusters are not canonical unless user explicitly confirms them through a domain action.

Color rules:

1. Color is a stable visual mapping from clusterId/colorKey.
2. Color does not define cluster membership.
3. Changing color must not change tags, notes, links, tasks or topics.
4. If user manually assigns a color to a tag/topic later, that is user preference metadata, not graph fact.

The graph may render:

- same cluster → similar color
- stronger relation → shorter force distance / thicker edge
- older note → different opacity or timeline inclusion
- newer note → different opacity or timeline inclusion

But all such visual decisions are view-layer choices.

### 15.7 Timeline filtering

The graph cloud must support timeline-style filtering in future milestones.

Filters:

- created_at range
- updated_at range
- before date
- after date
- between dates

Required future behavior:

1. User can keep only notes created before a date.
2. User can keep only notes created after a date.
3. User can scrub a timeline and see cloud evolution.
4. User can switch between created_at and updated_at timeline modes.
5. Edges should disappear if either source or target node is filtered out.

Timeline filtering is a projection concern. It must not delete or rewrite underlying notes, tags, tasks or links.

### 15.8 Filtering and focus

Future graph view should support these filters:

```
node type:
  notes
  tags
  tasks
  topics
edge type:
  wiki
  tag
  task-ref
  task-tag
  suggested
  cooccurrence
time:
  created_at / updated_at
  from / to
task:
  open / done
  hot / cold
  urgent / normal
cluster:
  selected cluster ids
focus:
  node id + graph depth
```

Focus mode example:

```
focus on note A with depth=1
→ show note A
→ show directly connected tags, tasks, notes
→ hide everything else
```

Depth 2:

```
show neighbors of neighbors
```

Focus/filter state is view state, not canonical data.

### 15.9 Layout architecture

The graph layout engine is separate from the graph projection.

Correct future layering:

```
GraphProjectionService
→ GraphLayoutService
→ GraphRenderer
```

GraphProjectionService answers:

> what exists and how it is connected

GraphLayoutService answers:

> where nodes should appear in 2D/3D space

GraphRenderer answers:

> how to draw and interact with it

Potential future implementation:

```
GraphProjectionService: app code / TypeScript
GraphLayoutService: d3-force or d3-force-3d
GraphRenderer: Three.js / React Three Fiber / react-force-graph-3d
```

M0–M4 must not import these graph rendering libraries.

### 15.10 Layout positions and persistence

Default:

> 3D/2D positions are derived and temporary.
> They are not canonical data.

Do not add graph position tables in M0–M4.

Later, after UX validation, a separate milestone may add optional layout cache:

```sql
CREATE TABLE graph_layout_positions (
  layout_id  TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  z          REAL NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (layout_id, node_id)
);
```

Rules for layout cache:

1. Cache can be deleted and recomputed.
2. Cache does not define graph relationships.
3. Pinned positions are user layout preferences.
4. Deleting layout cache must not affect notes, tasks, tags or links.

### 15.11 User interactions in graph view

Future graph interactions can trigger domain actions, but only through explicit app commands.

Allowed examples:

```
click note node → open note
click tag node → filter by tag
click task node → open task panel
select cluster → apply cluster filter
drag node → adjust temporary/pinned layout position
```

Potentially allowed later, but must be explicit domain actions:

```
connect two notes in graph → create [[wiki link]] or suggested link after confirmation
remove edge → remove corresponding wiki link/tag only after confirmation
assign node to topic → create/confirm topic membership
```

Forbidden:

```
renderer silently creates links because nodes are close
renderer silently removes links because filter hides them
renderer changes tags because user dragged a node
renderer changes cluster membership because layout moved
```

Graph interactions can propose structure, not silently rewrite canonical data.

### 15.12 Future roadmap for graph cloud

Graph work is explicitly out of M0–M4.

Recommended future milestones:

```
M5 — GraphProjectionService:
  typed graph projection from notes/tags/tasks/links/refs
  filters
  tests
M6 — 2D Graph Prototype:
  simple graph renderer
  inspect nodes/edges
  filters by tag/time/type
  validate UX and data correctness
M7 — 3D Interactive Knowledge Cloud:
  Three.js/WebGL renderer
  d3-force-3d layout
  rotate/zoom/pan
  cluster colors
  timeline scrubber
  focus mode
M8 — Graph UX hardening:
  saved graph views
  stable layout cache
  pinned nodes
  performance limits
  large graph degradation strategy
M9 — Semantic layer integration:
  suggested links
  semantic topics
  cluster confirmation flow
```

2D graph should come before 3D graph unless Architect explicitly overrides. Reason: 2D is faster for validating graph data, filters, edge types and UX before investing in 3D complexity.

### 15.13 Performance constraints for future graph

The graph must degrade gracefully.

Expected personal-scale ranges:

```
small:      < 500 nodes
medium:    500–5,000 nodes
large:     5,000–25,000 nodes
very large: > 25,000 nodes
```

Future renderer must support limits:

- max nodes
- max edges
- focus mode
- cluster-only overview
- progressive expansion
- hide weak edges
- filter before render

Renderer must not attempt to draw everything if the graph becomes unreadable.

View strategy:

```
overview first
focus on selected cluster/node
expand gradually
list fallback always available
```

### 15.14 UX principles for graph view

Graph cloud must not become decorative noise.

Principles:

1. Graph is an exploration mode, not the primary note editor.
2. Filters are more important than visual spectacle.
3. Colors must have stable meaning.
4. Clusters must be explainable.
5. User must be able to inspect why two nodes are connected.
6. Manual links are stronger than suggested links.
7. Suggested links must be visually distinguishable.
8. Timeline filtering must never delete data.
9. 2D/list fallback is mandatory.
10. Graph layout is not truth; it is only a view.

Every edge should be explainable:

```
"Connected because note A links to note B"
"Connected because both have #armenia"
"Connected because task X appears in note Y"
"Suggested because semantic similarity is high"
```

### 15.15 Additional invariants for future graph work

When graph milestones begin, Reviewer must check:

- GRAPH-INV-1. GraphProjectionService reads from repositories/domain APIs, not raw renderer state.
- GRAPH-INV-2. Renderer does not import SQLite or repositories directly.
- GRAPH-INV-3. Graph projection is recomputable from canonical data + derived indexes.
- GRAPH-INV-4. Layout positions are not canonical relationship data.
- GRAPH-INV-5. Filters do not mutate canonical data.
- GRAPH-INV-6. Visual cluster membership is derived unless user explicitly confirms a topic/tag change.
- GRAPH-INV-7. Manual edges and suggested edges are distinguishable by type.
- GRAPH-INV-8. Timeline mode uses created_at/updated_at without rewriting records.
- GRAPH-INV-9. Every displayed edge has an explainable source.
- GRAPH-INV-10. Graph dependencies such as Three.js/D3 are not introduced before a dedicated graph milestone.

### 15.16 Impact on current M0–M4 worker tasks

This section does not add implementation tasks to M0–M4.

It only constrains current work:

1. Keep note_links in schema.
2. Keep note_tags/task_tags/task_refs as derived indexes.
3. Preserve created_at/updated_at fields.
4. Preserve link_type on note_links.
5. Do not collapse all relationships into untyped strings.
6. Do not couple data access to UI components.
7. Do not make graph renderer part of storage/repository layer.

If a worker wants to simplify schema by removing graph-related fields because "not used yet", reject the PR.

The future graph cloud depends on today's clean separation:

```
canonical data
derived indexes
graph projection
layout
renderer
```
