# Logging

A simple, extendable and customizable logging module.

## Import

```typescript
import { Logger } from "semola/logging";
```

## Logger

**`new Logger(prefix: string, providers: [LoggerProvider, ...LoggerProvider[]])`**

Create a logger instance with a prefix and with at least one provider.
In the following example, the `logger` instance will format and print all
your messages on the console using `"database"` as a prefix.

```typescript
// log.ts
const logger = new Logger("database", [new ConsoleProvider()]);

logger.debug("A debug");
logger.info("An info");
logger.warning("A warning");
logger.error("An error");
logger.critical("A critical");

// Logs all the messages into the console
// 2026-03-09T11:38:33.436Z  [DEBUG]       [database/log.ts:5:8] : A debug
// 2026-03-09T11:38:33.439Z  [INFO]        [database/log.ts:6:8] : An info
// 2026-03-09T11:38:33.440Z  [WARNING]     [database/log.ts:7:8] : A warning
// 2026-03-09T11:38:33.440Z  [ERROR]       [database/log.ts:8:8] : An error
// 2026-03-09T11:38:33.441Z  [CRITICAL]    [database/log.ts:9:8] : A critical
```

`debug(msg: LogMessageType): void`, `info(msg: LogMessageType): void`, `warning(msg: LogMessageType): void`, `error(msg: LogMessageType): void` and `critical(msg: LogMessageType): void` methods accept a value of type `LogMessageType = string | number | boolean | object`.

### Create a custom logger

In case you want to create your own logger, you need to create subclass that extends the `AbstractLogger` class. The `AbstractLogger` class, provides the `prefix` and the `providers` attributes to all subclasses and each subclass need to implement the following abstract methods:

- `debug(msg: LogMessageType): void`,
- `info(msg: LogMessageType): void`,
- `warning(msg: LogMessageType): void`,
- `error(msg: LogMessageType): void`
- `critical(msg: LogMessageType): void`

Inside each method, you first create a `LogDataType` object, which is explained in the [Create a new provider](#create-a-new-provider) section, and then pass this object as an argument to the `execute()` method of each provider you passed.

Here a quick example on implementing a custom logger for an API:

```typescript
class APILogger extends AbstractLogger {
  private api: string;

  constructor(
    api: string,
    prefix: string,
    providers: [LoggerProvider, ...LoggerProvider[]],
  ) {
    super(prefix, providers);
    this.api = api;
  }

  public debug(msg: LogMessageType): void {
    const data = this.createLogData("debug", msg, this.prefix);
    const apiData = this.createLogData("debug", this.api, this.prefix);
    const [provider] = this.providers;

    if (!provider) throw new Error("No providers");

    provider.execute(data);
    provider.execute(apiData);
  }

  public info(msg: LogMessageType): void {
    // Implementation
  }
  public warning(msg: LogMessageType): void {
    // Implementation
  }
  public error(msg: LogMessageType): void {
    // Implementation
  }
  public critical(msg: LogMessageType): void {
    // Implementation
  }
}
```

## Provider

Providers are classes that enable the use of different logging strategies. The module provide the two most common approaches:

- **console**: All your logs are redirected on the console. This strategy is implemented inside the `ConsoleProvider` class;
- **file**: All your logs are saved inside a file and it support both plain text and structured data format, like JSON. This strategy is implemented inside the `FileProvider` class.

By default, all providers format a message as a string.

### ConsoleProvider

The `ConsoleProvider(option?: ProviderOptions)` class direct all logging messages on the console. It accepts an `option` object with the following properties:

- **`level`** (optional) - A string that define the log level and by default is set to _"debug"_;
- **`formatter`** (optional) - Define how the provider should format a message. By default it use and instance of the `BaseFormatter()` class.

The type for the `level` property is: `LogLevelType = "debug" | "info" | "warning" | "error" | "critical"`

**Example**

```typescript
// log.ts
const logger = new Logger("database", [
  new ConsoleProvider({
    level: "warning",
  }),
]);

logger.debug("A debug");
logger.info("An info");
logger.warning("A warning");
logger.error("An error");
logger.critical("A critical");

// Logs only the messages with a logging level equal or greater to "warning" into the console
// 2026-03-09T11:38:33.440Z  [WARNING]     [database/log.ts:7:8] : A warning
// 2026-03-09T11:38:33.440Z  [ERROR]       [database/log.ts:8:8] : An error
// 2026-03-09T11:38:33.441Z  [CRITICAL]    [database/log.ts:9:8] : A critical
```

### FileProvider

The `FileProvider(file: string, options?: FileProviderOptions)` class direct all logging messages inside a text or JSON file. It accepts the following arguments:

- **`file`** (required): Path of where logging files are saved;
- `options` (optional) -
  - **`level`** (optional) - Define the log level and by default is set to _"debug"_;
  - **`formatter`** (optional) - Define how the provider should format a message. By default it use and instance of the `BaseFormatter()` class.
  - **`policy`** (optional) - An object which define the type of rolling strategy to implement. By default it use a size based rolling strategy.

**Example**

```typescript
// log.ts
const logger = new Logger("database", [
  new FileProvider("file.txt", { level: "warning" }),
]);

logger.debug("A debug");
logger.info("An info");
logger.warning("A warning");
logger.error("An error");
logger.critical("A critical");
```

```txt
// file.0.txt
2026-03-09T15:23:01.961Z  [WARNING]	[database/test.ts:9:8] : A warning
2026-03-09T15:23:01.962Z  [ERROR]	[database/test.ts:10:8] : An error
2026-03-09T15:23:01.962Z  [CRITICAL]	[database/test.ts:11:8] : A critical
2026-03-09T15:23:05.512Z  [WARNING]	[database/test.ts:9:8] : A warning
2026-03-09T15:23:05.512Z  [ERROR]	[database/test.ts:10:8] : An error
2026-03-09T15:23:05.512Z  [CRITICAL]	[database/test.ts:11:8] : A critical
```

All created files will follow this simple patter: `<filename>.<number>.<ext>` where the second component it's a number created by an internal counter.

**Rolling Policies**

With the object `policy` you can decide how to roll your files. Currently the `FileProvider` class support two types: `size` and `time`.

- If set to `"size"`, you can define the max size of each file and, after reaching that limit, the provider will create automatically the next file.
- If set to `"time"`, you can define on which time interval the next file will be created. For example you can roll a new file every month or every day.

The following tables will show how the `policy` object change based on the rolling strategy you choose.

| Size based rolling property |   Type   | Required | Default Value | Note                                                                                             |
| --------------------------- | :------: | :------: | :-----------: | ------------------------------------------------------------------------------------------------ |
| `maxSize`                   | `number` |    No    |    `4096`     | Define the max size of each file in bytes. The default value is equal to 4KB expressed in bytes. |

Note that `InstantType = "hour" | "day" | "week" | "month"`

| Time based rolling property |     Type      | Required | Default Value | Note                                                    |
| --------------------------- | :-----------: | :------: | :-----------: | ------------------------------------------------------- |
| `duration`                  |   `number`    |   yes    |      `-`      | Define after of much time a new file should be created. |
| `instant`                   | `InstantType` |   yes    |      `-`      | Define when a new file should be created.               |

### Create a new provider

If you need to create a custom provider, you can easily do that by extending your class with the `LoggerProvider` class. `LoggerProvider` is an abstract class and all its subclasses must override the abstract method `execute(data: LogDataType): void` and call its constructor by passing a formatter and the logging level. The `LoggerProvider` class expose the following public method:

- `getLogLevel(): number` - Return the current logging level expressed as a number. This can be used to filter messages based on their level.

Here a quick example on creating a provider for aggregating a certain amount of files inside a zip folder.

```typescript
// zip.ts
class ZipProvider extends LoggerProvider {
  private maxFile: number;

  constructor(maxFile: number, options: ProviderOptions) {
    super({ formatter: options.formatter, level: options.level });
    this.maxFile = maxFile;
  }

  public execute(data: LogDataType): void {
    // Implementation
  }
}

// log.ts
const logger = new Logger("database", [new ZipProvider()]);
```

The following table show what type of metadata are stored inside a `LogDataType` object

| Field      | Type             | Nullable | Note                                                                       |
| ---------- | ---------------- | :------: | -------------------------------------------------------------------------- |
| `prefix`   | `string`         |    no    | The prefix passed as an argument into the `Logger` class constructor.      |
| `level`    | `LogLevelType`   |    no    | The log level passed as an option into the the `Logger` class constructor. |
| `msg`      | `LogMessageType` |    no    | The message to log.                                                        |
| `fileName` | `string`         |    no    | The file name of a file in which a logging method was called.              |
| `row`      | `number`         |    no    | Row of the method call.                                                    |
| `column`   | `number`         |    no    | Column of the method call.                                                 |
| `method`   | `string`         |   yes    | The method name in which a logging method was called.                      |

For instance, this is how a message is formatted by default.

```text
<timestamp>  [<level>]       [<method>]  [<prefix>/<fileName>:<row>:<column>] : <msg>
```

## Formatters

### Formatting messages

Semola's logging module provides two simple out of the box formatting classes and also the ability to create custom formatters. By default all providers us the `BaseFormatter` class with produce strings containing all the information, or a small subset, collected inside a `LogDataType`. The following list shows which formatters the module expose:

- `BaseFormatter(dateFmt?: DateFmtFnType)` - Its the default class;
- `JSONFormatter(dateFmt?: DateFmtFnType)` - Format the content of a `LogDataType` as a JSON. This is useful when you want to save your messages inside a JSON file.

`dateFmt` is an optional argument you can use to pass a function to format the timestamp showed in the log message. By default this timestamp is formatted with the ISO format. This function have zero parameters and return a string.

Here an example on how to use both of the formatters

```typescript
const stringLogger = new Logger("database", [
  new ConsoleProvider({
    formatter: new BaseFormatter(),
  }),
]);

const jsonLogger = new Logger("database", [
  new ConsoleProvider({
    formatter: new JSONFormatter(),
  }),
]);

stringLogger.info("Formatted as a string");
jsonLogger.info("Formatted as a JSON object");

// Print:
// 2026-03-09T20:10:40.072Z  [INFO]        [database/test.ts:16:14] : Formatted as a string
// {"timestamp":"2026-03-09T20:10:40.076Z","level":"INFO","prefix":"database","position":{"fileName":"test.ts","row":"17","column":"12"},"msg":"Formatted as a JSON object"}
```

. Here a list of all the pre-built date formatting functions:

- `isoDateTimeFormat(): string` - Return a date as a string value formatted with the ISO format;
- `isoDateFormat(): string` - Return a date as a string value formatted with the ISO format with only the date component;
- `dmyFormat(): string` - Return a date as a string value with the `dd-mm-yyyy` format;
- `mdyFormat(): string` - Return a date as a string value with the `mm-dd-yyyy` format.

### Formatting errors

In case you need to format errors, you can use the `formatError(logData: LogDataType, error: Error): string` method. Note that all providers use this method for formatting errors throwed during the formatting phase.

### Create a new formatter

In case you need to format your messages in a different way, you can create a new class that extends the `Formatter` abstract class. Every subclass need to implement the `format(logData: LogDataType): string` and the `formatError(logData: LogDataType, error: Error): string` with all the necessary logic for formatting a message or an error. In addition, the base class constructor should be called with the date formatting function of your choice.

Here a quick example on how to create a logging message similar on how is formatted in [Effect](https://effect.website/docs/observability/logging/#log)

```typescript
// formatter.ts
class EffectFormatter extends Formatter {
  public constructor(dateFmt: DateFmtFnType = isoDateTimeFormat) {
    super(dateFmt);
  }

  public format(logData: LogDataType): string {
    const { level, msg } = logData;
    const timestamp = this.dateFmt();

    return `timestamp=${timestamp} level=${level.toUpperCase()} message="${msg}"`;
  }

  public formatError(logData: LogDataType, error: Error): string {
    return `message=${error.message} cause=${error.cause}`;
  }
}

// log.ts
const effectLogger = new Logger("database", [
  new ConsoleProvider({
    formatter: new EffectFormatter(),
  }),
]);

effectLogger.info("Formatted with a custom class");

// Print
// timestamp=2026-03-09T20:45:43.905Z level=INFO message="Formatted with a custom class"
```

## Credits

Huge thanks to [Python's logging facility](https://docs.python.org/3/library/logging.html) and [Effect logging functionalities](https://effect.website/docs/observability/logging/) for the inspiration and also for the API interface and organization.
