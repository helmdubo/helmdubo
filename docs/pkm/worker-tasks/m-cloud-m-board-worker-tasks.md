# PKM App — M-Board / M-Cloud Worker Tasks

Спека для агентов-исполнителей. Контекст: `orchestrator-brief-v3.md` + `orchestrator-brief-v4-delta.md`. Термины и инварианты — оттуда. Оба milestone'а независимы и могут исполняться параллельно; точка слияния — TC.4.

Общие требования ко всем задачам:

- Данные — только через StorageAdapter/репозитории (INV-5).
- `npm run lint`, `npm run test`, `npm run build` зелёные после каждой задачи.
- Новые модули с логикой (не React-обвязка) покрываются unit-тестами Vitest.

---

# Milestone M-Board

## TB.1 — `[[` автокомплит + создание заметки из frontier-ссылки

Цель: активное связывание не выходя из текста.

Файлы (ориентир):

- `src/notes/wikiAutocompleteExtension.ts`
- `src/notes/MarkdownEditor.tsx`
- `src/notes/NoteEditorScreen.tsx`
- `src/notes/wikiAutocompleteExtension.test.ts`

Критерии приёмки:

1. Ввод `[[` открывает автокомплит по заголовкам существующих заметок (case-insensitive подстрока, ≤8 подсказок).
2. Accept вставляет `[[Заголовок]]` и закрывает автокомплит.
3. Пункт «Создать „<ввод>"» вставляет `[[<ввод>]]`, заметку не создаёт.
4. Клик по frontier-ссылке (target отсутствует) показывает action «Создать заметку»; подтверждение создаёт заметку через NoteRepo с этим title.
5. После создания и reconcile обеих сторон `note_links.target_note_id` проставлен.
6. Список заголовков для автокомплита читается через NoteRepo, не через прямой SQL.

## TB.2 — Индекс unlinked mentions + миграция dismissals

Цель: пассивная детекция связей как derived index.

Файлы (ориентир):

- `src/db/schema.sql` (v2: `link_suggestion_dismissals` по дельте §C)
- `src/db/migrate.ts`
- `src/db/reconcile.ts`
- `src/db/reconcile.test.ts`
- `src/db/migrate.test.ts`

Критерии приёмки:

1. Миграция v2 создаёт `link_suggestion_dismissals`; существующая БД v1 мигрирует без потери данных.
2. `rebuildNoteDerivedIndex` дополнительно пишет suggested-строки в `note_links` по правилам дельты §B.2 (whole-word, case-insensitive, title ≥3 символов).
3. Исключения работают: code blocks, inline code, существующие `[[...]]`, самоупоминание, task-ref строки.
4. Пары из dismissals не попадают в suggested-индекс.
5. Suggested-строки сбрасываются и пересобираются при каждом reconcile (derived index, INV-2).
6. Тест INV-9: после `rebuildNoteDerivedIndex` содержимое `notes.markdown` байт-в-байт не изменилось.

## TB.3 — Mention-декорации и материализация

Цель: подсветка suggestion'ов в редакторе и явные действия пользователя.

Файлы (ориентир):

- `src/notes/mentionExtension.ts`
- `src/notes/NoteEditorScreen.tsx`
- `src/notes/mentionExtension.test.ts`

Критерии приёмки:

1. Suggested mentions подсвечиваются пунктирным подчёркиванием; markdown не изменён.
2. Клик по mention показывает два действия: «Связать» и «Скрыть».
3. «Связать» оборачивает вхождение в `[[...]]` одной editor transaction; после reconcile связь становится `link_type='wiki'`.
4. «Скрыть» пишет строку в `link_suggestion_dismissals`; подсветка исчезает и не возвращается после переоткрытия заметки.
5. Декорации обновляются после reconcile без перезагрузки страницы.
6. Подсветка не срабатывает внутри code blocks / inline code / `[[...]]`.

## TB.4 — Task drawer

Цель: клик по задаче в тексте открывает объект задачи без потери контекста.

Файлы (ориентир):

- `src/tasks/TaskDrawer.tsx`
- `src/notes/taskRefExtension.ts` (click handler)
- `src/tasks/TaskPool.tsx` (переиспользование drawer)
- `src/App.tsx`

Критерии приёмки:

1. Клик по task-ref widget открывает drawer (панель справа ≥768px, bottom sheet уже); текст заметки остаётся видимым.
2. Drawer показывает title, status, deadline, urgency и список заметок с ref'ами задачи; клик по заметке — переход в неё.
3. Правка title/status в drawer идёт через TaskRepo; текущая ref-строка перерендеривается сразу, остальные — по правилам v3 §8.5.
4. Правка deadline/urgency сохраняется и переживает reload.
5. Тот же drawer открывается из task pool.
6. Esc / клик мимо закрывает drawer без потери несохранённого текста заметки.

---

# Milestone M-Cloud

## Модель сил (нормативная)

Узлы — заметки. Позиция `p_n`. Итоговая сила:

```
F(n) = F_charge(n) + F_collide(n) + F_link(n) + F_tag(n) + F_center(n)
```

| Сила | Реализация | Параметр по умолчанию |
|---|---|---|
| F_charge | d3.forceManyBody | strength = −70 |
| F_collide | d3.forceCollide | r = radius(n) + 3 |
| F_link | d3.forceLink | distance = 46; strength: wiki = 0.5, suggested = 0.15 |
| F_tag | кастомная, см. ниже | k_tag = 0.10 |
| F_center | forceX/forceY к центру | strength = 0.015 |

Гравитация тегов:

```
F_tag(n) = Σ_{t ∈ tags(n)} (k_tag · α / |tags(n)|) · (C_t − p_n)
```

- `C_t` — якорь тега: детерминированная круговая раскладка вокруг центра; порядок тегов — по убыванию числа заметок, при равенстве — лексикографически.
- Заметка без тегов не получает F_tag (дрейфует к периферии — ожидаемое поведение).
- Заметка с k тегами притягивается к k якорям с весом 1/k → мостовые заметки висят между кластерами.

Детерминизм: начальные позиции узлов — seeded PRNG (mulberry32 от хэша note id), не Math.random. Один и тот же набор данных даёт один и тот же settled layout.

Параметры k_tag и link strength выносятся в конфиг-объект layout-движка (не в UI в v1).

Позже (вне scope): semantic springs как третий тип ребра `kind='semantic'` со strength = w_sim — архитектура рёбер должна это допускать (kind — расширяемый union).

## TC.1 — GraphDataProvider

Цель: view model облака из репозиториев.

Файлы (ориентир):

- `src/graph/GraphDataProvider.ts`
- `src/graph/graphTypes.ts`
- `src/graph/GraphDataProvider.test.ts`
- при необходимости точечные методы в NoteRepo/TagRepo/TaskRepo

Контракт:

```ts
interface GraphNodeVM {
  id: string;
  title: string;
  tags: string[];        // отсортированы: доминирующий первым (по числу заметок тега)
  openTaskCount: number; // задачи со status='open', имеющие ref в этой заметке
  degree: number;        // число рёбер
}
interface GraphEdgeVM {
  source: string;
  target: string;
  kind: 'wiki' | 'suggested';
}
interface GraphVM { nodes: GraphNodeVM[]; edges: GraphEdgeVM[]; }
buildGraphVM(adapter: StorageAdapter): Promise<GraphVM>
```

Критерии приёмки:

1. Рёбра — только `note_links` с ненулевым `target_note_id`; frontier-ссылки в облако не попадают.
2. Дубликаты пар схлопнуты; при наличии wiki и suggested для одной пары остаётся wiki.
3. `openTaskCount` считается из `task_refs` × `tasks.status`.
4. Заметки без тегов и без связей присутствуют в nodes.
5. Данные читаются только через StorageAdapter/репозитории.
6. Unit-тесты на пункты 1–4 на in-memory adapter.

## TC.2 — Layout-движок

Цель: чистый модуль физики без React и без canvas.

Файлы (ориентир):

- `src/graph/layoutEngine.ts`
- `src/graph/tagAnchors.ts`
- `src/graph/layoutEngine.test.ts`

Критерии приёмки:

1. `createLayout(vm, config)` возвращает `{ nodes, start, stop, reheat, onTick }`; внутри d3-force по модели сил выше.
2. Кастомная F_tag реализована по формуле, включая деление на |tags(n)|.
3. Якоря тегов детерминированы (порядок и позиции воспроизводимы), тест подтверждает.
4. Начальные позиции — seeded PRNG от note id; два запуска на одних данных дают идентичные settled-позиции (тест с фиксированным числом тиков).
5. Симуляция замораживается после settle (alpha < 0.005) и перезапускается через `reheat()` при изменении данных.
6. Модуль не импортирует React и DOM API (проверяется тестом окружения node).

## TC.3 — CloudView: canvas-рендер и взаимодействие

Цель: отрисовка и прямое взаимодействие с облаком.

Файлы (ориентир):

- `src/graph/CloudView.tsx`
- `src/graph/renderer.ts`
- `src/graph/interactions.ts`

Критерии приёмки:

1. Canvas 2D с учётом devicePixelRatio; цвета читаются из CSS-переменных темы (работает в light/dark).
2. Узел: цвет = доминирующий тег (детерминированное соответствие тег→палитра), кольцо = второй тег, серый = без тегов; radius = f(degree); бейдж с openTaskCount > 0.
3. Рёбра: wiki заметнее, suggested бледнее/пунктиром.
4. Лейбл `#тег` рисуется у центроида кластера (среднее позиций заметок тега).
5. Zoom/pan (d3.zoom) и drag узлов работают одновременно и не конфликтуют; hover показывает title.
6. 500 узлов / 800 рёбер держат ≥30 fps на десктопе после settle (рендер только по requestAnimationFrame при активной симуляции или взаимодействии).

## TC.4 — Интеграция Cloud в приложение

Цель: облако как третий view и навигационный хаб. Выполняется после мержа M-Board.

Файлы (ориентир):

- `src/App.tsx`
- `src/graph/CloudView.tsx`
- `src/index.css`

Критерии приёмки:

1. Верхняя навигация: Notes / Tasks / Cloud.
2. Клик по узлу открывает заметку в Board.
3. Клик по лейблу тега подсвечивает кластер и даёт переход в task pool с фильтром по тегу (существующий механизм jumpToTag).
4. После редактирования заметки (reconcile) возврат в Cloud отражает новые теги/связи без перезагрузки страницы (reheat).
5. Пустое состояние: при <2 заметках Cloud показывает приглашение создать заметки, не пустой canvas.

---

# Definition of done для обоих milestone'ов

- Все критерии приёмки задач выполнены.
- lint + test + build зелёные.
- eslint-правило `no-restricted-imports` запрещает импорт sqlite вне `src/storage` (делается в первой же задаче любого milestone'а, если ещё не сделано).
- Ручной сценарий: создать 5 заметок с тегами и упоминаниями друг друга → принять 2 suggestion'а → создать 2 задачи из текста → открыть Cloud → кластеры видны, клик по узлу возвращает в заметку, drawer открывается по клику на задачу.
