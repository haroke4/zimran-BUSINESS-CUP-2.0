# StoryFork до анимации объектов

Здесь восстановлена версия генератора, в которой модель рисует статичную SVG-панораму, а персонаж и камера движутся по сценарию. Сохранённый коридор из того прогона открывается без повторной генерации.

```sh
npm --prefix hypothesis-non-production/test_no_asset_before_animation start
```

Откройте [сохранённый проход](http://127.0.0.1:8794/?saved=1) или [генератор](http://127.0.0.1:8794/). Для новой генерации сервер использует существующие настройки NVIDIA NIM, Groq или Gemini из `hypothesis-non-production/test/.env` и `hypothesis-non-production/test_no_asset/.env`. Сохранённый проход работает без ключей.

Версия [с анимацией объектов](../test_no_asset/README.md) находится в `test_no_asset`. Для параллельного запуска на другом порту используйте:

```sh
OPENROUTER_API_KEY= NO_ASSET_PORT=8793 npm --prefix hypothesis-non-production/test_no_asset start
```
