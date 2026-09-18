import {
  HISTORICAL_PROBLEM_RAW_CHARS,
  LARGE_REALISTIC_UAT_FIXTURE_ID,
  LONG_TURN_MAX_SECONDS,
  LONG_TURN_MIN_SECONDS,
  MIN_RAW_CHARS,
  TARGET_DURATION_MAX_SECONDS,
  TARGET_DURATION_MIN_SECONDS,
  TARGET_RAW_CHARS_MAX,
  TARGET_RAW_CHARS_MIN,
  TARGET_SEGMENT_MAX,
  TARGET_SEGMENT_MIN,
} from "./large-realistic-uat-constants";

export type LargeRealisticSpeaker = "speaker_0" | "speaker_1";

export type LargeRealisticRawTurn = {
  speakerLabel: LargeRealisticSpeaker;
  text: string;
};

export type LargeRealisticSegment = {
  orderIndex: number;
  speakerLabel: LargeRealisticSpeaker;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  text: string;
};

export type LargeRealisticLongTurn = {
  speakerLabel: LargeRealisticSpeaker;
  startOrderIndex: number;
  endOrderIndex: number;
  segmentCount: number;
  durationSeconds: number;
  rawChars: number;
};

export type LargeRealisticFixtureStats = {
  fixtureId: string;
  synthetic: true;
  domain: "supplier_buyer_b2b_negotiation";
  speakers: { speaker_0: "BUYER"; speaker_1: "SELLER" };
  rawChars: number;
  words: number;
  segments: number;
  estimatedDurationSeconds: number;
  ratioVsHistorical9592: number;
  longTurn1: LargeRealisticLongTurn;
  longTurn2: LargeRealisticLongTurn;
};

/**
 * Deterministic RAW SpeechKit-like source. `finalizeTurns` only folds and
 * lengthens this fixed list; it does not sample random text.
 * speaker_0 = BUYER, speaker_1 = SELLER.
 */
const SOURCE_TURNS: readonly LargeRealisticRawTurn[] = [
  { speakerLabel: "speaker_0", text: "добрый день мы готовы обсуждать поставку комплектующих на следующий квартал и хотим сразу пройти цену качество и график" },
  { speakerLabel: "speaker_1", text: "Здравствуйте. Мы тоже хотим закрыть рамку сегодня, чтобы производство не стояло без подтверждённого объёма." },
  { speakerLabel: "speaker_0", text: "давайте начнём с цены текущая сетка для нас высоковата особенно на основной номенклатуре" },
  { speakerLabel: "speaker_1", text: "Понял. Тогда зафиксируем повестку: цена, брак, замена, отгрузки, прогноз, оплата, сервис, штрафы, приёмка, гарантия и эскалация." },
  { speakerLabel: "speaker_0", text: "да именно так и ещё нам важно чтобы всё было в одном протоколе без размытых формулировок" },
  { speakerLabel: "speaker_1", text: "Согласны. Протокол сделаем рабочим, без маркетинговых обещаний." },
  { speakerLabel: "speaker_0", text: "ну вот смотрите по базовой позиции мы сейчас видим сто двадцать восемь за единицу это выше нашего потолка" },
  { speakerLabel: "speaker_1", text: "Сто двадцать восемь включает входной контроль, упаковку и резерв на логистический риск. Без этого цифра была бы ниже." },
  { speakerLabel: "speaker_0", text: "мы считали иначе наш расчёт даёт сто двенадцать если снять избыточный резерв и упростить упаковку" },
  { speakerLabel: "speaker_1", text: "Упростить упаковку можно, но не на экспортных партиях. Там требования жёсткие." },
  { speakerLabel: "speaker_0", text: "для внутреннего контура давайте отдельную цену а экспорт оставим как есть" },
  { speakerLabel: "speaker_1", text: "Внутренний контур можем посадить на сто восемнадцать при объёме от десяти тысяч в квартал." },
  { speakerLabel: "speaker_0", text: "десять тысяч это много для старта давайте восемь тысяч и цену сто шестнадцать" },
  { speakerLabel: "speaker_1", text: "Восемь тысяч для нас погранично. Если подтверждаете выборку без отмены, могу дать сто семнадцать." },
  { speakerLabel: "speaker_0", text: "сто семнадцать возможно если предоплата не выше двадцати процентов и есть опция плюс десять на первую партию" },
  { speakerLabel: "speaker_1", text: "Опцию плюс десять дадим на первую партию. Предоплату хотели тридцать, но можем обсудить двадцать пять." },
  { speakerLabel: "speaker_0", text: "двадцать пять ещё высоко казначейство не пропустит давайте двадцать и остаток после приёмки" },
  { speakerLabel: "speaker_1", text: "Тогда нужен короткий срок приёмки. Иначе кассовый разрыв ляжет на нас." },
  { speakerLabel: "speaker_0", text: "приёмку по внутренней партии закроем за семь рабочих дней если документы полные" },
  { speakerLabel: "speaker_1", text: "Семь дней принимаем, если акт не зависает на одном подписанте." },
  { speakerLabel: "speaker_0", text: "сделаем двух подписантов чтобы не было узкого горлышка это разумно" },
  { speakerLabel: "speaker_1", text: "Хорошо. По цене пока рабочая вилка: сто семнадцать внутренний контур, экспорт отдельно." },
  { speakerLabel: "speaker_0", text: "экспорт давайте тоже назовём цифру не хочу оставлять это на потом" },
  { speakerLabel: "speaker_1", text: "Экспорт сто двадцать четыре при той же спецификации и сертификации на нашей стороне." },
  { speakerLabel: "speaker_0", text: "сто двадцать четыре тяжеловато если сертификация уже заложена в процесс" },
  { speakerLabel: "speaker_1", text: "Часть сертификации разовая. Можем размазать стоимость на первые две партии." },
  { speakerLabel: "speaker_0", text: "тогда первая экспортная сто двадцать две вторая сто двадцать одна дальше сто двадцать" },
  { speakerLabel: "speaker_1", text: "Близко. Первая сто двадцать три, вторая сто двадцать два, далее сто двадцать один. Это мой предел без пересмотра сырья." },
  { speakerLabel: "speaker_0", text: "если сырьё скакнёт больше чем на пять процентов нужна формула а не внезапный пересмотр" },
  { speakerLabel: "speaker_1", text: "Формулу дадим. Индексация только после порога пять процентов и с уведомлением за четырнадцать дней." },
  { speakerLabel: "speaker_0", text: "четырнадцать дней мало нам нужно двадцать один чтобы пересобрать заказ поставщикам внутри" },
  { speakerLabel: "speaker_1", text: "Двадцать один принимаем, если вы не держите подтверждение объёма до последнего дня." },
  { speakerLabel: "speaker_0", text: "объём будем подтверждать не позже чем за двадцать пять дней до окна отгрузки" },
  { speakerLabel: "speaker_1", text: "Тогда формула живая. Фиксируем порог, срок уведомления и отсутствие молчаливого согласия." },
  { speakerLabel: "speaker_0", text: "молчаливого согласия не будет нужен письменный акцепт с нашей стороны" },
  { speakerLabel: "speaker_1", text: "Письменный акцепт ок. Если молчите пять рабочих дней, цена не меняется автоматически." },

  // Long uninterrupted SELLER turn (~3 minutes): quality, defects, replacement, warranty logic.
  { speakerLabel: "speaker_1", text: "теперь по качеству я хочу пройти это одним блоком чтобы не прыгать потому что у нас уже был болезненный опыт когда брак обсуждали кусками и потом никто не помнил процедуру" },
  { speakerLabel: "speaker_1", text: "фактический уровень дефектов на сопоставимой номенклатуре у нас за последний год был около полутора процентов а не четырёх как иногда рисуют на слухах" },
  { speakerLabel: "speaker_1", text: "но я понимаю что вам нужен не средний показатель а худший месяц поэтому предлагаю считать целевой брак не выше двух процентов по входящему контролю" },
  { speakerLabel: "speaker_1", text: "если в конкретной партии входящий контроль показывает больше двух процентов мы не спорим про статистику а сразу запускаем замену этой партии" },
  { speakerLabel: "speaker_1", text: "замена идёт не как любезность а как обязанность в срок десять рабочих дней с момента подписанного акта о несоответствии" },
  { speakerLabel: "speaker_1", text: "акт должен содержать фото артикул номер партии количество и короткое описание дефекта без философских формулировок" },
  { speakerLabel: "speaker_1", text: "если дефект повторяется в двух партиях подряд мы делаем разбор причины в пять рабочих дней и даём письменный план корректирующих действий" },
  { speakerLabel: "speaker_1", text: "план включает ответственного срок проверку на нашей линии и контрольную выборку до следующей отгрузки" },
  { speakerLabel: "speaker_1", text: "резерв на брак предлагаю три процента от партии это больше чем наш факт но меньше чем ваш страх и это честный компромисс" },
  { speakerLabel: "speaker_1", text: "резерв не означает что вы можете просто недоплатить три процента он используется только против подтверждённого несоответствия" },
  { speakerLabel: "speaker_1", text: "если несоответствия нет резерв закрывается в том же акте приёмки и остаток оплаты идёт по графику" },
  { speakerLabel: "speaker_1", text: "критичный дефект который останавливает вашу линию обрабатываем отдельно не через общую очередь замены" },
  { speakerLabel: "speaker_1", text: "для критичного дефекта у нас дежурный инженер в рабочее время и эскалация на руководителя смены в течение двух часов" },
  { speakerLabel: "speaker_1", text: "если линия стоит по нашей вине мы компенсируем не абстрактный простой а подтверждённые прямые затраты по согласованному тарифу" },
  { speakerLabel: "speaker_1", text: "тариф надо зафиксировать заранее чтобы потом не торговаться в стрессе это важно" },
  { speakerLabel: "speaker_1", text: "входной контроль у вас может быть выборочным но методика должна быть согласована иначе любой брак превращается в спор о выборке" },
  { speakerLabel: "speaker_1", text: "я пришлю методику сегодня вечером вы либо принимаете либо даёте правки до завтра обеда" },
  { speakerLabel: "speaker_1", text: "гарантийный срок на комплектующие двенадцать месяцев с даты приёмки не с даты отгрузки это в вашу пользу" },
  { speakerLabel: "speaker_1", text: "износ от неправильного хранения и самостоятельная доработка без нашего согласования в гарантию не входят это надо прямо написать" },
  { speakerLabel: "speaker_1", text: "если вы хотите расширенную гарантию до восемнадцати месяцев это уже отдельная цена не внутри сто семнадцати" },
  { speakerLabel: "speaker_1", text: "я не буду прятать это в мелкий шрифт лучше сейчас честно сказать что восемнадцать месяцев стоят плюс два пункта к цене" },
  { speakerLabel: "speaker_1", text: "и последнее в этом блоке спорные случаи не висят вечно если эксперты не сходятся за десять дней идём к согласованной третьей лаборатории" },

  { speakerLabel: "speaker_0", text: "спасибо блок понятен по браку два процента нам подходит если контроль по согласованной методике" },
  { speakerLabel: "speaker_0", text: "резерв три процента принимаем но списание только против акта не автоматически" },
  { speakerLabel: "speaker_1", text: "Да, только против акта. Это симметрично." },
  { speakerLabel: "speaker_0", text: "замена за десять дней ок но критичный дефект должен закрываться быстрее чем обычная замена" },
  { speakerLabel: "speaker_1", text: "Для критичного дефекта цель — комплекты в пути за семьдесят два часа, если позиция на складе." },
  { speakerLabel: "speaker_0", text: "если позиции нет на складе какой крайний срок не хочу слово по возможности" },
  { speakerLabel: "speaker_1", text: "Крайний срок пять рабочих дней с письменным статусом каждые сутки. Без статуса это уже наше нарушение." },
  { speakerLabel: "speaker_0", text: "хорошо по гарантии двенадцать месяцев достаточно расширенную пока не берём" },
  { speakerLabel: "speaker_1", text: "Зафиксируем двенадцать. Восемнадцать оставим опцией в приложении." },
  { speakerLabel: "speaker_0", text: "третью лабораторию давайте назовём заранее иначе в конфликте будем выбирать месяц" },
  { speakerLabel: "speaker_1", text: "Предлагаю независимую лабораторию из согласованного списка из трёх. Выбор по очереди: сначала вы, потом мы." },
  { speakerLabel: "speaker_0", text: "список пришлите письмом сегодня чтобы юристы посмотрели названия" },
  { speakerLabel: "speaker_1", text: "Отправлю до конца дня. Без сюрпризов в пятницу вечером." },
  { speakerLabel: "speaker_0", text: "теперь график отгрузок нам нужно три окна в квартале а не одна большая машина в конце" },
  { speakerLabel: "speaker_1", text: "Три окна можем. Предлагаю недели 2, 6 и 10 квартала, с допуском плюс-минус два дня." },
  { speakerLabel: "speaker_0", text: "неделя два для нас рановато склад ещё не готов давайте недели 3 7 и 11" },
  { speakerLabel: "speaker_1", text: "Неделя 3 проходит, если подтверждение объёма придёт за двадцать пять дней, как вы сказали." },
  { speakerLabel: "speaker_0", text: "подтверждение будет да но первая партия меньше последующих чтобы обкатать приёмку" },
  { speakerLabel: "speaker_1", text: "Первая две тысячи, вторая три, третья три. Итого восемь, если внутренний контур остаётся на восьми тысячах." },
  { speakerLabel: "speaker_0", text: "внутренний восемь экспорт отдельно две тысячи в том же квартале если сертификация успеет" },
  { speakerLabel: "speaker_1", text: "Экспортные две тысячи поставим во второе окно, не в первое. Так безопаснее по документам." },
  { speakerLabel: "speaker_0", text: "согласны второе окно для экспорта первое только внутренний контур" },
  { speakerLabel: "speaker_1", text: "Тогда логистика проще. Не смешиваем сертификаты в одной машине." },
  { speakerLabel: "speaker_0", text: "доставка до нашего склада на вас да страхование груза тоже" },
  { speakerLabel: "speaker_1", text: "До склада да. Страхование включено во внутреннюю цену. На экспорте отдельной строкой, это прозрачнее." },
  { speakerLabel: "speaker_0", text: "на экспорте страхование можете дать как опцию не обязательную если наш экспедитор кроет" },
  { speakerLabel: "speaker_1", text: "Опция. Если берёте своего экспедитора, мы передаём на терминале и фиксируем акт передачи." },
  { speakerLabel: "speaker_0", text: "акт передачи с фото и пломбами иначе потом спорим кто повредил" },
  { speakerLabel: "speaker_1", text: "Фото, пломбы, номер машины, время выезда. Это уже стандарт у нас." },
  { speakerLabel: "speaker_0", text: "хорошо теперь прогноз нам нужен скользящий на два квартала вперёд не только текущий" },
  { speakerLabel: "speaker_1", text: "Скользящий прогноз принимаем: жёсткий квартал плюс индикативный следующий." },
  { speakerLabel: "speaker_0", text: "индикативный не должен превращаться в обязаловку если рынок проседает" },
  { speakerLabel: "speaker_1", text: "Индикатив не заказ. Заказом становится только письменное подтверждение окна." },
  { speakerLabel: "speaker_0", text: "если индикатив уедет больше чем на тридцать процентов вы хотите компенсацию за материал" },
  { speakerLabel: "speaker_1", text: "Только если мы закупили сырьё по вашему письменному запросу на резерв. Без письма — наш риск." },
  { speakerLabel: "speaker_0", text: "резерв сырья будем запрашивать точечно не как постоянную привычку" },
  { speakerLabel: "speaker_1", text: "Идеально. Точечный резерв с датой истечения, иначе склад превращается в музей." },
  { speakerLabel: "speaker_0", text: "срок резерва не больше сорока пяти дней потом либо заказ либо снимаем" },
  { speakerLabel: "speaker_1", text: "Сорок пять дней ок. Напоминание за десять дней до истечения отправим сами." },
  { speakerLabel: "speaker_0", text: "по объёму следующего квартала ориентир двенадцать тысяч если цена удержится" },
  { speakerLabel: "speaker_1", text: "Двенадцать тысяч для нас хороший якорь. Под него можно держать мощность, не закупая лишнее сырьё вслепую." },
  { speakerLabel: "speaker_0", text: "якорь не обязательство ещё раз это важно юридически" },
  { speakerLabel: "speaker_1", text: "Понимаю. В договоре будет слово ориентир, не take-or-pay." },

  // Long uninterrupted BUYER turn (~3 minutes): payment, penalties, acceptance mechanics.
  { speakerLabel: "speaker_0", text: "теперь оплата я тоже пройду сплошняком потому что у нас казначейство очень формальное и любая дырка в формулировке потом стоит недели согласований" },
  { speakerLabel: "speaker_0", text: "предоплата двадцать процентов в течение пяти банковских дней после подписания спецификации на конкретное окно не после рамочного договора" },
  { speakerLabel: "speaker_0", text: "рамка сама по себе денег не двигает иначе мы будем платить за воздух если окно сдвинется" },
  { speakerLabel: "speaker_0", text: "остаток восемьдесят процентов в течение десяти банковских дней после подписанного акта приёмки без скрытых условий про хорошее настроение склада" },
  { speakerLabel: "speaker_0", text: "если акт не подписан по нашей вине дольше семи рабочих дней вы имеете право на письменную претензию и фиксацию даты готовности" },
  { speakerLabel: "speaker_0", text: "но вы не имеете право считать товар принятым молча это для нас красная линия" },
  { speakerLabel: "speaker_0", text: "частичная приёмка возможна если дефект затрагивает только часть партии тогда оплачиваем годное и резервируем сумму по дефектному количеству" },
  { speakerLabel: "speaker_0", text: "штраф за просрочку отгрузки предлагаю ноль три процента в день но не больше десяти процентов от суммы просроченной партии" },
  { speakerLabel: "speaker_0", text: "штраф за просрочку оплаты зеркальный ноль три процента в день и тоже потолок десять процентов чтобы это было не наказание а дисциплина" },
  { speakerLabel: "speaker_0", text: "если просрочка отгрузки срывает наш экспортный слот и это доказано бронью перевозчика можно отдельно обсудить фактические затраты сверх потолка" },
  { speakerLabel: "speaker_0", text: "но только по документам не по словам менеджера на складе это важно" },
  { speakerLabel: "speaker_0", text: "приёмка начинается в день поступления плюс уведомление от вас за сутки иначе наша смена не стоит в ожидании машины" },
  { speakerLabel: "speaker_0", text: "уведомление должно содержать номер заказа количество пломбы и плановое время прибытия с допуском два часа" },
  { speakerLabel: "speaker_0", text: "если машина приехала без уведомления мы можем взять её в очередь а не в приоритет и это не будет считаться нашей просрочкой приёмки" },
  { speakerLabel: "speaker_0", text: "документы на партию комплект счёт упаковочный лист сертификаты и паспорт качества без этого приёмка не стартует по часам" },
  { speakerLabel: "speaker_0", text: "электронные копии можно слать заранее оригиналы либо с грузом либо на следующий день курьером как договоримся в спецификации" },
  { speakerLabel: "speaker_0", text: "валюта рублей платежи с расчётного счёта компании без третьих лиц и без схем взаимозачёта в мессенджере" },
  { speakerLabel: "speaker_0", text: "если понадобится закрывать период в конце квартала мы можем ускорить оплату за скидку один пункт это опция не обязанность" },
  { speakerLabel: "speaker_0", text: "и ещё одно казначейство требует чтобы штрафы и премии не смешивались в одном платежном поручении отдельные строки отдельные основания" },
  { speakerLabel: "speaker_0", text: "если вы с этим согласны я готов зафиксировать оплату как согласованный каркас и не возвращаться к предоплате тридцать процентов" },

  { speakerLabel: "speaker_1", text: "Каркас оплаты принимаем: двадцать после спецификации окна, восемьдесят после акта, без молчаливой приёмки." },
  { speakerLabel: "speaker_1", text: "Штраф ноль три и потолок десять зеркально ок. Сверх потолка только по доказанному сорванному слоту." },
  { speakerLabel: "speaker_0", text: "хорошо теперь сервис какой у вас уровень реакции не в рекламной брошюре а фактически" },
  { speakerLabel: "speaker_1", text: "Рабочие дни, ответ на инцидент четыре часа, обходное решение до конца следующего дня, корневая причина в пяти рабочих." },
  { speakerLabel: "speaker_0", text: "четыре часа это с момента письма на общую почту или с момента в тикетнице" },
  { speakerLabel: "speaker_1", text: "С тикета. Общая почта слишком легко теряется. Заведём общий канал и номера тикетов в акте." },
  { speakerLabel: "speaker_0", text: "канал давайте корпоративный не личные мессенджеры менеджеров люди уходят переписка пропадает" },
  { speakerLabel: "speaker_1", text: "Корпоративный портал. Личные чаты только для оперативного пина, юридической силы нет." },
  { speakerLabel: "speaker_0", text: "в договоре так и напишем что мессенджер не изменяет спецификацию" },
  { speakerLabel: "speaker_1", text: "Обязательно. Иначе через месяц получим десять версий правды." },
  { speakerLabel: "speaker_0", text: "нужно ещё окно консультаций инженера два часа в неделю в первый месяц внедрения" },
  { speakerLabel: "speaker_1", text: "Два часа в неделю в первый месяц включим. Потом по запросу, уже тарифицировано." },
  { speakerLabel: "speaker_0", text: "тариф консультаций пришлите отдельно чтобы закупки не путали с ценой изделия" },
  { speakerLabel: "speaker_1", text: "Отдельным приложением. Не внутри сто семнадцати." },
  { speakerLabel: "speaker_0", text: "по штрафам кроме отгрузки есть срыв реакции если тикет висит дольше четырёх часов без ответа" },
  { speakerLabel: "speaker_1", text: "За срыв реакции не денежный штраф, а эскалация на директора направления в тот же день. Деньги оставим на отгрузку и оплату." },
  { speakerLabel: "speaker_0", text: "может быть сервисные баллы если три раза подряд сорвали реакцию пересматриваем менеджера и процесс" },
  { speakerLabel: "speaker_1", text: "Три срыва подряд — обязательный разбор с протоколом. Это сильнее, чем символические баллы." },
  { speakerLabel: "speaker_0", text: "протокол принимаем приложите шаблон чтобы наши аудиторы были спокойны" },
  { speakerLabel: "speaker_1", text: "Шаблон будет. Дата, тикет, причина, действие, срок, проверка." },
  { speakerLabel: "speaker_0", text: "приёмка ещё раз если документы неполные часы не идут это надо в договор явно" },
  { speakerLabel: "speaker_1", text: "Явно. Чек-лист документов приложением, не сноской мелким шрифтом." },
  { speakerLabel: "speaker_0", text: "кто подписывает акт с вашей стороны нужна доверенность не просто фамилия в вотсапе" },
  { speakerLabel: "speaker_1", text: "Доверенность и образцы подписей до первой отгрузки. Иначе акт можно оспорить." },
  { speakerLabel: "speaker_0", text: "с нашей стороны два подписанта как договаривались склад и качество" },
  { speakerLabel: "speaker_1", text: "Отлично. Если один в отпуске, второй может закрыть акт один, это пропишем как исключение." },
  { speakerLabel: "speaker_0", text: "исключение да но с уведомлением вам что второй временно единственный" },
  { speakerLabel: "speaker_1", text: "Уведомление за день. Иначе мы не поймём, почему акт не двигается." },
  { speakerLabel: "speaker_0", text: "гарантийный случай как открывается тикет фото серийник и дата приёмки минимум" },
  { speakerLabel: "speaker_1", text: "Минимум такой. Без серийника можем взять в работу, но срок диагностики длиннее на два дня." },
  { speakerLabel: "speaker_0", text: "серийники будем требовать на упаковке и в паспорте качества чтобы не ловить потом" },
  { speakerLabel: "speaker_1", text: "На упаковке и в паспорте. Дублирование специально, это дешевле спора." },
  { speakerLabel: "speaker_0", text: "если гарантийный дефект массовый больше одного процента партии что делаем" },
  { speakerLabel: "speaker_1", text: "Массовый случай — отзывная процедура: стоп следующих отгрузок этой ревизии, разбор, замена уже отгруженного по согласованному списку." },
  { speakerLabel: "speaker_0", text: "стоп отгрузок да но не стоп наших линий если есть безопасная ревизия на складе у вас" },
  { speakerLabel: "speaker_1", text: "Если есть чистая ревизия, ставим её. Стоп только на проблемный код." },
  { speakerLabel: "speaker_0", text: "эскалация уровни давайте один операционный два руководитель направления три директора через сорок восемь часов" },
  { speakerLabel: "speaker_1", text: "Сорок восемь часов на переход к директорам многовато для стоящей линии. Для линии — двенадцать часов, для бумажных споров — сорок восемь." },
  { speakerLabel: "speaker_0", text: "давайте так линия двенадцать часов документы сорок восемь это разумное разделение" },
  { speakerLabel: "speaker_1", text: "И контакты в приложении с заместителями. Один человек в отпуске не должен обнулять эскалацию." },
  { speakerLabel: "speaker_0", text: "контакты обновим ежеквартально иначе через полгода это археология" },
  { speakerLabel: "speaker_1", text: "Ежеквартально плюс внепланово при кадровом изменении. Это дешёвая дисциплина." },
  { speakerLabel: "speaker_0", text: "если директора не сходятся за пять рабочих дней медиация или суд какой порядок" },
  { speakerLabel: "speaker_1", text: "Сначала переговоры директоров, потом медиация из списка, суд как крайняя мера по месту покупателя." },
  { speakerLabel: "speaker_0", text: "место покупателя нам подходит это наш стандарт" },
  { speakerLabel: "speaker_1", text: "Принимаем. Не будем прятать подсудность." },
  { speakerLabel: "speaker_0", text: "ещё по качеству входной контроль у нас может быть ночным не задержите ответы на ночные акты" },
  { speakerLabel: "speaker_1", text: "Ночной акт регистрируем утром. Срок замены считаем с регистрации, это честно по сменам." },
  { speakerLabel: "speaker_0", text: "если акт пришёл в пятницу вечером регистрация утро понедельника да" },
  { speakerLabel: "speaker_1", text: "Да, кроме критичного простоя линии. Критичный идёт через дежурного даже в выходной." },
  { speakerLabel: "speaker_0", text: "дежурный телефон в приложении и правило что это не рекламная линия" },
  { speakerLabel: "speaker_1", text: "Только простой линии и безопасность. Цена и график туда не звонят." },
  { speakerLabel: "speaker_0", text: "хорошо давайте свернём что уже твёрдое чтобы не расползлось" },
  { speakerLabel: "speaker_1", text: "Внутренний контур восемь тысяч, цена сто семнадцать, предоплата двадцать, остаток после акта." },
  { speakerLabel: "speaker_0", text: "ок экспорт две тысячи во втором окне цена лестницей сто двадцать три сто двадцать два сто двадцать один" },
  { speakerLabel: "speaker_1", text: "Да. Формула сырья порог пять процентов, уведомление двадцать один день, письменный акцепт." },
  { speakerLabel: "speaker_0", text: "брак цель два процента резерв три замена десять дней критичное семьдесят два часа или пять дней если нет склада" },
  { speakerLabel: "speaker_1", text: "Гарантия двенадцать месяцев, массовый отзыв по ревизии, третья лаборатория из списка." },
  { speakerLabel: "speaker_0", text: "график окна 3 7 11 первая партия две тысячи потом три и три экспорт во втором окне" },
  { speakerLabel: "speaker_1", text: "Прогноз скользящий, индикатив не заказ, резерв сырья сорок пять дней по письму." },
  { speakerLabel: "speaker_0", text: "штрафы зеркальные ноль три до десяти сервис четыре часа ответа эскалация линия двенадцать документы сорок восемь" },
  { speakerLabel: "speaker_1", text: "Канал корпоративный, мессенджер без силы, чек-лист документов, доверенности до первой отгрузки." },
  { speakerLabel: "speaker_0", text: "юристы с обеих сторон сверяют формулировки завтра до обеда если нет сюрпризов считаем каркас согласованным" },
  { speakerLabel: "speaker_1", text: "Завтра до обеда пришлю красную правку договора. Без новых коммерческих сюрпризов с моей стороны." },
  { speakerLabel: "speaker_0", text: "и с нашей тоже если всплывёт только уточнение приёмки не пересчёт цены" },
  { speakerLabel: "speaker_1", text: "Договорились. Тогда сегодня вечером ещё методика контроля и список лабораторий." },
  { speakerLabel: "speaker_0", text: "да и шаблон протокола разбора и контакты эскалации чтобы пакет был полным" },
  { speakerLabel: "speaker_1", text: "Пакет будет: методика, лаборатории, протокол, контакты, черновик спецификации первого окна." },
  { speakerLabel: "speaker_0", text: "спецификацию первого окна давайте сразу на две тысячи внутренний контур неделя три" },
  { speakerLabel: "speaker_1", text: "Сделаю черновик. Вы подтверждаете адрес склада и окно приёмки в том же письме." },
  { speakerLabel: "speaker_0", text: "адрес склада пришлю сегодня контакты приёмки тоже чтобы водитель не искал охрану полчаса" },
  { speakerLabel: "speaker_1", text: "И схему проезда, пожалуйста. Это мелочь, которая экономит слот." },
  { speakerLabel: "speaker_0", text: "схему приложу есть pdf от логистики свежий" },
  { speakerLabel: "speaker_1", text: "Отлично. Тогда технически мы готовы запускать рамку, коммерчески — после завтрашней сверки юристов." },
  { speakerLabel: "speaker_0", text: "да не будем объявлять победу раньше сверки но рабочий контур я считаю собранным" },
  { speakerLabel: "speaker_1", text: "Я тоже. Спасибо за конкретный разговор, без воды." },
  { speakerLabel: "speaker_0", text: "спасибо тогда на связи вечером по пакетам документов" },
  { speakerLabel: "speaker_1", text: "На связи. Если что-то из пакета задержится, напишу статус, не буду молчать." },
  { speakerLabel: "speaker_0", text: "статус даже короткий лучше чем тишина это мы тоже фиксируем как правило работы" },
  { speakerLabel: "speaker_1", text: "Правило работы принимаем. На этом предлагаю закончить основную часть." },
  { speakerLabel: "speaker_0", text: "согласны завершаем коммерческую часть протокол завтра после юристов" },
];

const LONG_TURN_SPEAKERS: [LargeRealisticSpeaker, LargeRealisticSpeaker] = [
  "speaker_1",
  "speaker_0",
];

const DETERMINISTIC_ELABORATIONS = [
  "это нужно прямо записать в протокол чтобы потом не спорить по памяти",
  "давайте без общих слов а с цифрой сроком и ответственным",
  "я повторяю чтобы стенограмма не потеряла условие на стыке реплик",
  "для внутреннего согласования нам важна одна фраза без двусмысленности",
  "если оставляем как есть то завтра юристы всё равно вернут этот абзац",
  "это рабочая формулировка её можно вставить в спецификацию почти дословно",
  "мы не раздуваем объём просто закрываем хвост который обычно всплывает позже",
  "прошу считать это частью той же мысли а не новой повесткой",
  "иначе получится дырка между коммерцией и операционкой как в прошлых рамках",
  "фиксируем нейтральным языком без оценки кто сильнее на переговорах",
] as const;

type MutableTurn = { speakerLabel: LargeRealisticSpeaker; text: string };

function cloneTurns(turns: readonly LargeRealisticRawTurn[]): MutableTurn[] {
  return turns.map((turn) => ({ speakerLabel: turn.speakerLabel, text: turn.text }));
}

function sameSpeakerRunBounds(turns: readonly LargeRealisticRawTurn[]): Array<{
  speakerLabel: LargeRealisticSpeaker;
  start: number;
  end: number;
}> {
  const runs: Array<{ speakerLabel: LargeRealisticSpeaker; start: number; end: number }> = [];
  let index = 0;
  while (index < turns.length) {
    let end = index;
    while (end + 1 < turns.length && turns[end + 1]!.speakerLabel === turns[index]!.speakerLabel) {
      end += 1;
    }
    runs.push({ speakerLabel: turns[index]!.speakerLabel, start: index, end });
    index = end + 1;
  }
  return runs;
}

function mergeAdjacentPairsInRange(turns: MutableTurn[], start: number, end: number, merges: number): void {
  let remaining = merges;
  let cursor = start;
  while (remaining > 0 && cursor < end) {
    const next = cursor + 1;
    if (next > end) break;
    if (turns[cursor]!.speakerLabel !== turns[next]!.speakerLabel) {
      cursor += 1;
      continue;
    }
    turns[cursor] = {
      speakerLabel: turns[cursor]!.speakerLabel,
      text: `${turns[cursor]!.text} ${turns[next]!.text}`,
    };
    turns.splice(next, 1);
    end -= 1;
    remaining -= 1;
    cursor += 1;
  }
}

function isProtectedIndex(
  turns: readonly LargeRealisticRawTurn[],
  index: number,
): boolean {
  return sameSpeakerRunBounds(turns)
    .filter((run) => run.end - run.start >= 7)
    .sort((left, right) => right.end - right.start - (left.end - left.start))
    .slice(0, 2)
    .some((run) => index >= run.start && index <= run.end);
}

function foldToSegmentTarget(turns: MutableTurn[], targetCount: number): void {
  let index = turns.length - 1;
  while (turns.length > targetCount && index > 0) {
    const current = turns[index]!;
    if (isProtectedIndex(turns, index)) {
      index -= 1;
      continue;
    }
    let previousSame = -1;
    for (let search = index - 1; search >= 0; search -= 1) {
      if (isProtectedIndex(turns, search)) continue;
      if (turns[search]!.speakerLabel === current.speakerLabel) {
        previousSame = search;
        break;
      }
    }
    if (previousSame >= 0) {
      turns[previousSame] = {
        speakerLabel: turns[previousSame]!.speakerLabel,
        text: `${turns[previousSame]!.text} ${current.text}`,
      };
      turns.splice(index, 1);
    }
    index -= 1;
  }
}

function padToCharTarget(
  turns: MutableTurn[],
  minChars: number,
  skip: (index: number) => boolean,
): void {
  let chars = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  const eligible = turns.map((_, index) => index).filter((index) => !skip(index));
  if (eligible.length === 0) return;
  let step = 0;
  while (chars < minChars && step < 800) {
    const index = eligible[step % eligible.length]!;
    const extra = DETERMINISTIC_ELABORATIONS[step % DETERMINISTIC_ELABORATIONS.length]!;
    turns[index] = {
      speakerLabel: turns[index]!.speakerLabel,
      text: `${turns[index]!.text} ${extra}`,
    };
    chars += extra.length + 1;
    step += 1;
  }
}

function finalizeTurns(source: readonly LargeRealisticRawTurn[]): LargeRealisticRawTurn[] {
  const turns = cloneTurns(source);
  const runs = sameSpeakerRunBounds(turns)
    .filter((run) => run.end - run.start >= 7)
    .sort((left, right) => right.end - right.start - (left.end - left.start));
  const sellerRun = runs.find((run) => run.speakerLabel === "speaker_1");
  const buyerRun = runs.find((run) => run.speakerLabel === "speaker_0");
  if (sellerRun) {
    const extra = Math.max(0, sellerRun.end - sellerRun.start + 1 - 18);
    mergeAdjacentPairsInRange(turns, sellerRun.start, sellerRun.end, extra);
  }
  const buyerBounds = sameSpeakerRunBounds(turns).find(
    (run) =>
      run.speakerLabel === "speaker_0" &&
      buyerRun &&
      Math.abs(run.start - buyerRun.start) <= 8,
  );
  if (buyerBounds) {
    const extra = Math.max(0, buyerBounds.end - buyerBounds.start + 1 - 18);
    mergeAdjacentPairsInRange(turns, buyerBounds.start, buyerBounds.end, extra);
  }
  foldToSegmentTarget(turns, 168);
  padToCharTarget(turns, TARGET_RAW_CHARS_MIN, (index) => isProtectedIndex(turns, index));
  return turns;
}

export const LARGE_REALISTIC_RAW_TURNS: readonly LargeRealisticRawTurn[] =
  finalizeTurns(SOURCE_TURNS);

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

function durationForText(text: string): number {
  const words = wordCount(text);
  const chars = text.length;
  return Math.min(16.5, Math.max(6.2, words * 0.38 + chars * 0.018));
}

export function buildLargeRealisticSegments(
  turns: readonly LargeRealisticRawTurn[] = LARGE_REALISTIC_RAW_TURNS,
): LargeRealisticSegment[] {
  const segments: LargeRealisticSegment[] = [];
  let cursor = 0;
  for (const [index, turn] of turns.entries()) {
    const duration = durationForText(turn.text);
    const startSeconds = round1(cursor);
    const endSeconds = round1(cursor + duration);
    segments.push({
      orderIndex: index,
      speakerLabel: turn.speakerLabel,
      startSeconds,
      endSeconds,
      durationSeconds: round1(endSeconds - startSeconds),
      text: turn.text,
    });
    cursor = endSeconds + 0.36;
  }
  return segments;
}

function findLongTurns(segments: readonly LargeRealisticSegment[]): LargeRealisticLongTurn[] {
  const found: LargeRealisticLongTurn[] = [];
  let index = 0;
  while (index < segments.length) {
    const speaker = segments[index]!.speakerLabel;
    let end = index;
    while (end + 1 < segments.length && segments[end + 1]!.speakerLabel === speaker) {
      end += 1;
    }
    const slice = segments.slice(index, end + 1);
    const durationSeconds = round1(
      slice[slice.length - 1]!.endSeconds - slice[0]!.startSeconds,
    );
    if (
      slice.length >= 8 &&
      durationSeconds >= LONG_TURN_MIN_SECONDS &&
      durationSeconds <= LONG_TURN_MAX_SECONDS + 15
    ) {
      found.push({
        speakerLabel: speaker,
        startOrderIndex: slice[0]!.orderIndex,
        endOrderIndex: slice[slice.length - 1]!.orderIndex,
        segmentCount: slice.length,
        durationSeconds,
        rawChars: slice.reduce((sum, segment) => sum + segment.text.length, 0),
      });
    }
    index = end + 1;
  }
  return found;
}

export function measureLargeRealisticFixture(
  turns: readonly LargeRealisticRawTurn[] = LARGE_REALISTIC_RAW_TURNS,
): LargeRealisticFixtureStats {
  const segments = buildLargeRealisticSegments(turns);
  const rawChars = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  const words = turns.reduce((sum, turn) => sum + wordCount(turn.text), 0);
  const estimatedDurationSeconds = round1(
    segments.length === 0 ? 0 : segments[segments.length - 1]!.endSeconds,
  );
  const longTurns = findLongTurns(segments);
  const longTurn1 =
    longTurns.find((turn) => turn.speakerLabel === LONG_TURN_SPEAKERS[0]) ?? longTurns[0];
  const longTurn2 =
    longTurns.find(
      (turn) =>
        turn.speakerLabel === LONG_TURN_SPEAKERS[1] &&
        turn.startOrderIndex !== longTurn1?.startOrderIndex,
    ) ?? longTurns[1];
  if (!longTurn1 || !longTurn2) {
    throw new Error("Large realistic fixture is missing two long speaker turns.");
  }
  return {
    fixtureId: LARGE_REALISTIC_UAT_FIXTURE_ID,
    synthetic: true,
    domain: "supplier_buyer_b2b_negotiation",
    speakers: { speaker_0: "BUYER", speaker_1: "SELLER" },
    rawChars,
    words,
    segments: segments.length,
    estimatedDurationSeconds,
    ratioVsHistorical9592: Math.round((rawChars / HISTORICAL_PROBLEM_RAW_CHARS) * 100) / 100,
    longTurn1,
    longTurn2,
  };
}

export type FixturePreflightIssue = {
  code: string;
  message: string;
};

export function validateLargeRealisticFixture(
  turns: readonly LargeRealisticRawTurn[] = LARGE_REALISTIC_RAW_TURNS,
): { ok: boolean; stats: LargeRealisticFixtureStats; issues: FixturePreflightIssue[] } {
  const stats = measureLargeRealisticFixture(turns);
  const issues: FixturePreflightIssue[] = [];
  const joined = turns.map((turn) => turn.text).join("\n");

  if (turns.length !== stats.segments) {
    issues.push({
      code: "TURN_SEGMENT_MISMATCH",
      message: "Raw turn count does not match timed segment count.",
    });
  }
  if (stats.rawChars < MIN_RAW_CHARS) {
    issues.push({
      code: "RAW_CHARS_TOO_SMALL",
      message: `Raw chars ${stats.rawChars} are below minimum ${MIN_RAW_CHARS}.`,
    });
  }
  if (stats.rawChars < TARGET_RAW_CHARS_MIN || stats.rawChars > TARGET_RAW_CHARS_MAX) {
    issues.push({
      code: "RAW_CHARS_OUT_OF_TARGET",
      message: `Raw chars ${stats.rawChars} are outside ${TARGET_RAW_CHARS_MIN}-${TARGET_RAW_CHARS_MAX}.`,
    });
  }
  if (stats.segments < TARGET_SEGMENT_MIN || stats.segments > TARGET_SEGMENT_MAX) {
    issues.push({
      code: "SEGMENT_COUNT_OUT_OF_TARGET",
      message: `Segment count ${stats.segments} is outside ${TARGET_SEGMENT_MIN}-${TARGET_SEGMENT_MAX}.`,
    });
  }
  if (
    stats.estimatedDurationSeconds < TARGET_DURATION_MIN_SECONDS ||
    stats.estimatedDurationSeconds > TARGET_DURATION_MAX_SECONDS
  ) {
    issues.push({
      code: "DURATION_OUT_OF_TARGET",
      message: `Estimated duration ${stats.estimatedDurationSeconds}s is outside 25-35 minutes.`,
    });
  }
  for (const [label, turn] of [
    ["longTurn1", stats.longTurn1],
    ["longTurn2", stats.longTurn2],
  ] as const) {
    if (turn.durationSeconds < LONG_TURN_MIN_SECONDS || turn.durationSeconds > LONG_TURN_MAX_SECONDS) {
      issues.push({
        code: "LONG_TURN_DURATION",
        message: `${label} duration ${turn.durationSeconds}s is outside 2.5-3.5 minutes.`,
      });
    }
    if (turn.segmentCount < 8) {
      issues.push({
        code: "LONG_TURN_NOT_SPLIT",
        message: `${label} must be many consecutive ASR-like segments, not one giant segment.`,
      });
    }
  }
  if (stats.longTurn1.speakerLabel === stats.longTurn2.speakerLabel) {
    issues.push({
      code: "LONG_TURNS_SAME_SPEAKER",
      message: "The two long turns must belong to different speakers.",
    });
  }
  if (/negotaitions|yandex cloud customer|инн\s*\d{10}/i.test(joined)) {
    issues.push({
      code: "REAL_CUSTOMER_LEAK",
      message: "Fixture appears to contain real customer or production identity markers.",
    });
  }
  const empty = turns.filter((turn) => !turn.text.trim());
  if (empty.length > 0) {
    issues.push({
      code: "EMPTY_TURN",
      message: `Fixture has ${empty.length} empty turns.`,
    });
  }
  return { ok: issues.length === 0, stats, issues };
}

export const LARGE_REALISTIC_SEGMENTS = buildLargeRealisticSegments();
export const LARGE_REALISTIC_FIXTURE_STATS = measureLargeRealisticFixture();
