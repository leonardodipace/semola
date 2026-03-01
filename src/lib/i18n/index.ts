import type { BuildParamObject, GetNestedValue, NestedKeyOf } from "./types.js";

export class I18n<
  const TLocales extends Record<string, Record<string, unknown>>,
  TDefaultLocale extends keyof TLocales,
> {
  private locales: TLocales;
  private currentLocale: keyof TLocales;
  private defaultLocale: TDefaultLocale;

  public constructor(config: {
    defaultLocale: TDefaultLocale;
    locales: TLocales;
  }) {
    this.defaultLocale = config.defaultLocale;
    this.currentLocale = config.defaultLocale;
    this.locales = config.locales;
  }

  public setLocale(locale: keyof TLocales) {
    this.currentLocale = locale;
  }

  public getLocale() {
    return this.currentLocale;
  }

  public translate<TKey extends NestedKeyOf<TLocales[TDefaultLocale]>>(
    key: TKey,
    ...params: BuildParamObject<
      GetNestedValue<TLocales[TDefaultLocale], TKey> extends string
        ? GetNestedValue<TLocales[TDefaultLocale], TKey>
        : never
    > extends Record<string, never>
      ? []
      : [
          BuildParamObject<
            GetNestedValue<TLocales[TDefaultLocale], TKey> extends string
              ? GetNestedValue<TLocales[TDefaultLocale], TKey>
              : never
          >,
        ]
  ) {
    const currentTranslations = this.locales[this.currentLocale];
    const defaultTranslations = this.locales[this.defaultLocale];

    const translation =
      this.getNestedValue(currentTranslations, key) ??
      this.getNestedValue(defaultTranslations, key);

    if (typeof translation !== "string") {
      return key;
    }

    if (!translation) {
      return key;
    }

    const paramObj = params[0] as Record<string, unknown> | undefined;
    return this.substituteParams(translation, paramObj);
  }

  private getNestedValue(
    obj: Record<string, unknown> | undefined,
    path: string,
  ) {
    return path.split(".").reduce((current: unknown, key: string) => {
      if (typeof current !== "object") {
        return undefined;
      }

      if (current === null) {
        return undefined;
      }

      return (current as Record<string, unknown>)[key];
    }, obj);
  }

  private substituteParams(template: string, params?: Record<string, unknown>) {
    if (!params) return template;

    return template.replace(/\{(\w+):(\w+)\}/g, (_match, name) => {
      return String(params[name]);
    });
  }
}
