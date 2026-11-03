# Документация — buchnative

Счетоводна програма за българския пазар (2026, еврозона, базова валута EUR).
Този каталог е **текущото състояние на кода**, не пътната карта.

`PLAN.md` в корена е пътната карта (прототип + какво следва). За „какво има
днес“ чети тук. При нова функция: обнови `status.md` + съответния файл в
таблицата.

## Карта

| Файл | За какво |
|------|----------|
| [architecture.md](architecture.md) | Стек, портове, пакети, мултитенант |
| [modules.md](modules.md) | Екрани и модули в UI |
| [documents.md](documents.md) | Данъчни / вътрешни / производство; осчетоводяване |
| [opening-and-periods.md](opening-and-periods.md) | Начални салда по НСС и заключване на месеци |
| [financial-statements.md](financial-statements.md) | Баланс, ОПР, паричен поток, собствен капитал — формули |
| [objects.md](objects.md) | Търговски обекти, склад по обект, ДМА, протокол |
| [data-model.md](data-model.md) | Таблици и ключови колони |
| [api.md](api.md) | HTTP пътища |
| [conventions.md](conventions.md) | Baga/Boila ограничения, които не бива да се забравят |
| [ai.md](ai.md) | Защо Mistral (ЕС, евтин); ключ по фирма; VIES и скан |
| [status.md](status.md) | Направено / нарочно отложено / липсва |

## Стартиране

```bash
./scripts/dev.sh      # boilaDB :6575 → backend :8080 → frontend :3000
./scripts/seed.sh     # демо данни, след като backend е готов
./scripts/stop.sh
```

Вход: **`superadmin` / `123+123`**.
Отвори `http://localhost:3000`.

Референцията в `secret/` (inv + su-doxis) **не се комитва**. Ползва се само
като образец за екрани, полета и български правила.
