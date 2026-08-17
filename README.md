## Bitrix Connector

Bitrix Connector-ը Node.js ծառայություն է, որը Bitrix24 CRM-ից apartment տվյալները համաժամացնում է MySQL տվյալների բազայի հետ։

Ծրագիրը աշխատում է որպես background worker և՝

- ներբեռնում է Bitrix24-ի apartment գրառումները
- քարտեզագրում է Bitrix դաշտերը տեղական MySQL գրառումների հետ
- ըստ ընթացիկ տվյալների բազայի վիճակի կատարում է insert, update կամ skip
- գրանցում է մանրամասն sync log-եր `logs/` պանակում
- կարող է կառավարվել Telegram bot-ի միջոցով
- աշխատում է cron ժամանակացույցով

## Հնարավորություններ

- Apartment-ների պարբերական համաժամացում Bitrix24-ից
- MySQL-ում պահպանում՝ conflict ստուգումներով
- Յուրաքանչյուր run-ի համար առանձին log ֆայլ
- Telegram bot commands՝ status, manual sync, logs և scheduler control համար
- Scheduler-ի կարգավորումների պահպանում `src/config/scheduler.json` ֆայլում

## Նախագծի Կառուցվածք

- `src/server.js` - ծրագրի մեկնարկային ֆայլ
- `src/cron/scheduler.js` - cron scheduler և sync runner
- `src/sync/syncApartments.js` - apartment համաժամացման հիմնական լոգիկա
- `src/services/apartment.service.js` - MySQL կարդալու և գրելու helper-ներ
- `src/services/telegramBot.js` - Telegram կառավարման bot
- `src/config/bitrix.js` - Bitrix webhook client
- `src/config/db.js` - MySQL connection pool
- `src/utils/logger.js` - ֆայլային և console logging helper-ներ
- `src/utils/mappers.js` - Bitrix-ից MySQL քարտեզագրման կանոններ

## Պահանջներ

- Node.js 18+ խորհուրդ է տրվում
- MySQL տվյալների բազա
- Bitrix24 webhook URL
- Telegram bot token, եթե ուզում եք Telegram control

## Տեղադրում

```bash
npm install
```

## Environment Variables

Production-ում օգտագործեք `/etc/bitrix-connector/bitrix-connector.env` ֆայլը, իսկ ցանկության դեպքում կարող եք այլ path տալ `BITRIX_CONNECTOR_ENV_PATH`-ով.

```env
BITRIX_WEBHOOK=https://your-bitrix-domain/rest/...

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=secret
DB_NAME=bitrix_connector

TELEGRAM_BOT_TOKEN=123456:ABCDEF
TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321
```

### Փոփոխականների Նշումներ

- `BITRIX_WEBHOOK` - Bitrix webhook-ի հիմնական հասցեն, որն օգտագործվում է `crm.item.list` հարցման համար
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - MySQL կապի կարգավորումներ
- `TELEGRAM_BOT_TOKEN` - միացնում է Telegram bot-ը, եթե նշված է
- `TELEGRAM_ALLOWED_CHAT_IDS` - կամայական comma-separated allowlist՝ Telegram control-ի համար

Եթե `TELEGRAM_ALLOWED_CHAT_IDS` դատարկ է, bot-ը ընդունում է այն chat-ները, որոնք արդեն հաղորդակցվել են նրա հետ, և հիշում է նրանց ID-ները `data/telegram-chat-ids.json` ֆայլում։

## Ծրագրի Գործարկում

```bash
npm start
```

Սա միացնում է՝

- cron scheduler-ը
- Telegram bot polling loop-ը
- logging pipeline-ի սկզբնականացումը

## Ինչպես է Աշխատում Sync-ը

Sync job-ը Bitrix CRM-ից կարդում է `1038` entity type-ի գրառումները և դրանք քարտեզագրում տեղական `apartments` աղյուսակի մեջ։

Յուրաքանչյուր Bitrix item-ի համար ծրագիրը որոշում է՝

- building ID-ը `ufCrm11_1776077056` դաշտից
- entrance ID-ը `ufCrm11_1776077122` դաշտից
- room count-ը `ufCrm11_1776077288` դաշտից
- floor number-ը `ufCrm11_1776077300` դաշտից
- square meter արժեքը `ufCrm11_1776077273` դաշտից
- active price-ը `ufCrm11_1776093169` դաշտից
- duplex նշանը `ufCrm11_1779547935718` դաշտից
- apartment status-ը `stageId` դաշտից
- MySQL apartment ID-ը՝ Bitrix-ի մի քանի user field-երից մեկից

Տեղական գրառումը հետո՝

- insert է արվում, եթե համապատասխան apartment դեռ չկա
- update է արվում, եթե արժեքները փոխվել են
- skip է արվում, երբ անհրաժեշտ mapping տվյալները բացակայում են կամ conflict կա
- unchanged է մնում, եթե տվյալների բազան արդեն համապատասխանում է նոր տվյալներին

### Քարտեզագրման Կանոններ

Ընթացիկ mapping-ները գտնվում են `src/utils/mappers.js` ֆայլում՝

- `buildingMap` - քարտեզագրում է Bitrix building ID-ները տեղական building ID-ների հետ
- `entranceMap` - քարտեզագրում է Bitrix entrance ID-ները տեղական block անունների հետ
- `statusMap` - քարտեզագրում է Bitrix stage ID-ները apartment status-ների հետ
- `getFloorId(buildingId, floor)` - Bitrix floor number-ը վերածում է տեղական floor ID-ի

## Scheduler

Scheduler-ը կառավարվում է `src/cron/scheduler.js` ֆայլով։

Լռելյայն վարքագիծ՝

- enabled: `true` առաջին run-ի ժամանակ, եթե config ֆայլ չկա
- cron expression: `*/1 * * * *`

Scheduler-ի կարգավորումները պահվում են՝

- `src/config/scheduler.json`

Ժամանակացույցը կարող եք փոխել Telegram bot-ի միջոցով, և նոր կարգավորումները ավտոմատ պահպանվում են։

## Telegram Bot

Եթե `TELEGRAM_BOT_TOKEN`-ը նշված է, bot-ը սկսում է Telegram polling և տրամադրում է հետևյալ commands-ը՝

- `/start` - ցույց է տալիս կառավարման մենյուն
- `/status` - ցույց է տալիս scheduler-ի ընթացիկ վիճակը
- `/logs` - հնարավորություն է տալիս դիտել վերջին log ֆայլերը
- `/id` - ցույց է տալիս ընթացիկ chat ID-ն

Inline menu-ի միջոցով նաև կարող եք՝

- անմիջապես գործարկել sync
- միացնել կամ անջատել scheduler-ը
- փոխել schedule preset-ը
- ներբեռնել log ֆայլերը

## Logging

Յուրաքանչյուր sync run ստեղծում է նոր ֆայլ `logs/` պանակում։

Log-երը ներառում են՝

- sync-ի մեկնարկն ու ավարտը
- inserted, updated, unchanged և skipped apartment գրառումները
- validation և conflict warning-ները
- scheduler-ի իրադարձությունները

## Տվյալների Պահպանում

Ծրագիրը disk-ում պահում է մի քանի runtime ֆայլեր՝

- `logs/` - յուրաքանչյուր run-ի log-երը
- `data/telegram-chat-ids.json` - հիշված Telegram chat ID-ները
- `src/config/scheduler.json` - scheduler-ի վիճակն ու cron expression-ը

## Սպասվող Տվյալների Բազայի Աղյուսակներ

Կոդը ակնկալում է առնվազն հետևյալ աղյուսակները՝

- `blocks`՝ `id`, `building_id`, `name` դաշտերով
- `apartments`՝ `saveApartment()`-ում օգտագործվող դաշտերով, օրինակ `id`, `building_id`, `block_id`, `floor_id`, `number`, `status`, `square_meter`, `rooms`, `duplex`, `active_price`, `created_at`, `updated_at`

