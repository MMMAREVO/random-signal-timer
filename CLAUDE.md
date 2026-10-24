# Рандомный таймер сигналов — Telegram Mini App

## Источник правды

- Спецификация: docs/SPEC.md. План этапов: docs/PLAN.md. Тест-план: docs/TEST-PLAN.md.
- Любое изменение поведения: сначала SPEC, потом тесты, потом код.

## Стек

TypeScript, Vite, без UI-фреймворка. Vitest + happy-dom + Testing Library + fast-check. Playwright (+ axe). ESLint, Prettier.

## Правила

- Работаем строго по этапам. Следующий этап — только после моего подтверждения.
- Тесты этапа утверждены мной. НЕ меняй, не удаляй, не помечай skip/only существующие тесты.
  Если считаешь тест неверным — остановись и объясни почему.
- Этап готов, когда зелёные: npm run typecheck, npm run lint, npm test
  (и npm run e2e с этапа 7). Покажи вывод команд.
- src/domain и src/engine не обращаются к DOM, звуку, Telegram, Date.now и Math.random
  напрямую — только через переданные зависимости (это проверяет ESLint).
- Новые npm-зависимости — только после согласования.
- Коммит после каждого зелёного этапа: "stage N: …".

## Telegram Mini Apps

- Документация: https://core.telegram.org/bots/webapps
- Доступ к window.Telegram — только через src/platform/telegram.ts; вне Телеграма — заглушка.

## Команды

npm run dev | npm test | npm run e2e | npm run typecheck | npm run lint | npm run sounds

Если в среде задан HTTP(S)_PROXY, для e2e нужен `NO_PROXY=localhost,127.0.0.1`.
