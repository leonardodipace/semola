import { describe, expect, test } from "bun:test";
import { I18n } from "./index.js";

describe("I18n", () => {
  describe("Constructor and locale management", () => {
    test("should initialize with default locale", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: { greeting: "Hello" },
          es: { greeting: "Hola" },
        },
      });

      expect(i18n.getLocale()).toBe("en");
    });

    test("should set and get locale", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: { greeting: "Hello" },
          es: { greeting: "Hola" },
          fr: { greeting: "Bonjour" },
        },
      });

      expect(i18n.getLocale()).toBe("en");

      i18n.setLocale("es");
      expect(i18n.getLocale()).toBe("es");

      i18n.setLocale("fr");
      expect(i18n.getLocale()).toBe("fr");
    });
  });

  describe("Basic translation", () => {
    test("should translate simple string", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: { greeting: "Hello" },
          es: { greeting: "Hola" },
        },
      });

      expect(i18n.translate("greeting")).toBe("Hello");

      i18n.setLocale("es");
      expect(i18n.translate("greeting")).toBe("Hola");
    });

    test("should translate nested keys", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            messages: {
              welcome: "Welcome",
              goodbye: "Goodbye",
            },
          },
          es: {
            messages: {
              welcome: "Bienvenido",
              goodbye: "Adiós",
            },
          },
        },
      });

      expect(i18n.translate("messages.welcome")).toBe("Welcome");
      expect(i18n.translate("messages.goodbye")).toBe("Goodbye");

      i18n.setLocale("es");
      expect(i18n.translate("messages.welcome")).toBe("Bienvenido");
      expect(i18n.translate("messages.goodbye")).toBe("Adiós");
    });

    test("should translate deeply nested keys", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            app: {
              header: {
                title: "My Application",
                subtitle: "Welcome to our app",
              },
            },
          },
        },
      });

      expect(i18n.translate("app.header.title")).toBe("My Application");
      expect(i18n.translate("app.header.subtitle")).toBe("Welcome to our app");
    });
  });

  describe("Fallback behavior", () => {
    test("should fallback to default locale when key not found in current locale", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            greeting: "Hello",
            farewell: "Goodbye",
          },
          es: {
            greeting: "Hola",
            // farewell is missing
          },
        },
      });

      i18n.setLocale("es");
      expect(i18n.translate("greeting")).toBe("Hola");
      expect(i18n.translate("farewell")).toBe("Goodbye"); // Falls back to English
    });

    test("should return key when translation not found in any locale", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: { greeting: "Hello" },
          es: { greeting: "Hola" },
        },
      });

      // @ts-expect-error - Testing with non-existent keys to verify fallback behavior
      expect(i18n.translate("nonexistent")).toBe("nonexistent");
      // @ts-expect-error - Testing with non-existent keys to verify fallback behavior
      expect(i18n.translate("missing.key")).toBe("missing.key");
    });

    test("should fallback for nested keys", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            app: {
              title: "Application",
              description: "A great app",
            },
          },
          es: {
            app: {
              title: "Aplicación",
              // description is missing
            },
          },
        },
      });

      i18n.setLocale("es");
      expect(i18n.translate("app.title")).toBe("Aplicación");
      expect(i18n.translate("app.description")).toBe("A great app");
    });
  });

  describe("Parameter substitution", () => {
    test("should substitute single parameter", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            welcome: "Welcome, {name:string}!",
          },
        },
      });

      expect(i18n.translate("welcome", { name: "John" })).toBe(
        "Welcome, John!",
      );
      expect(i18n.translate("welcome", { name: "Alice" })).toBe(
        "Welcome, Alice!",
      );
    });

    test("should substitute multiple parameters", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            greeting: "Hello {name:string}, you have {count:number} messages",
          },
        },
      });

      expect(i18n.translate("greeting", { name: "Bob", count: 5 })).toBe(
        "Hello Bob, you have 5 messages",
      );
    });

    test("should work with different parameter types", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            status:
              "Status: {active:boolean}, ID: {id:number}, Name: {name:string}",
          },
        },
      });

      expect(
        i18n.translate("status", {
          active: true,
          id: 123,
          name: "Test",
        }),
      ).toBe("Status: true, ID: 123, Name: Test");
    });

    test("should handle parameters in nested translations", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            messages: {
              notification: "You have {count:number} new notifications",
            },
          },
        },
      });

      expect(i18n.translate("messages.notification", { count: 3 })).toBe(
        "You have 3 new notifications",
      );
    });

    test("should return template as-is when no parameters provided for parameterized string", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            message: "Hello {name:string}",
          },
        },
      });

      // @ts-expect-error - TypeScript would catch this, but testing runtime behavior
      expect(i18n.translate("message")).toBe("Hello {name:string}");
    });

    test("should handle multiple occurrences of same parameter", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            repeat: "{name:string} said hello to {name:string}",
          },
        },
      });

      expect(i18n.translate("repeat", { name: "Alice" })).toBe(
        "Alice said hello to Alice",
      );
    });
  });

  describe("Complex scenarios", () => {
    test("should handle multiple locales with parameters", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            welcome: "Welcome back, {name:string}!",
          },
          es: {
            welcome: "Bienvenido de nuevo, {name:string}!",
          },
          fr: {
            welcome: "Bon retour, {name:string}!",
          },
        },
      });

      expect(i18n.translate("welcome", { name: "John" })).toBe(
        "Welcome back, John!",
      );

      i18n.setLocale("es");
      expect(i18n.translate("welcome", { name: "John" })).toBe(
        "Bienvenido de nuevo, John!",
      );

      i18n.setLocale("fr");
      expect(i18n.translate("welcome", { name: "John" })).toBe(
        "Bon retour, John!",
      );
    });

    test("should handle real-world app structure", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            common: {
              save: "Save",
              cancel: "Cancel",
              delete: "Delete",
            },
            auth: {
              login: "Login",
              logout: "Logout",
              welcome: "Welcome back, {username:string}!",
            },
            errors: {
              notFound: "Page not found",
              serverError: "Server error occurred",
              validation: "Validation failed for {field:string}",
            },
          },
          es: {
            common: {
              save: "Guardar",
              cancel: "Cancelar",
              delete: "Eliminar",
            },
            auth: {
              login: "Iniciar sesión",
              logout: "Cerrar sesión",
              welcome: "Bienvenido de nuevo, {username:string}!",
            },
            errors: {
              notFound: "Página no encontrada",
              serverError: "Error del servidor",
              validation: "Validación fallida para {field:string}",
            },
          },
        },
      });

      // English
      expect(i18n.translate("common.save")).toBe("Save");
      expect(i18n.translate("auth.login")).toBe("Login");
      expect(i18n.translate("auth.welcome", { username: "John" })).toBe(
        "Welcome back, John!",
      );
      expect(i18n.translate("errors.validation", { field: "email" })).toBe(
        "Validation failed for email",
      );

      // Spanish
      i18n.setLocale("es");
      expect(i18n.translate("common.save")).toBe("Guardar");
      expect(i18n.translate("auth.login")).toBe("Iniciar sesión");
      expect(i18n.translate("auth.welcome", { username: "Juan" })).toBe(
        "Bienvenido de nuevo, Juan!",
      );
      expect(i18n.translate("errors.validation", { field: "correo" })).toBe(
        "Validación fallida para correo",
      );
    });

    test("should handle partial translations with fallback", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            dashboard: {
              title: "Dashboard",
              welcome: "Welcome to your dashboard",
              stats: {
                users: "Total Users: {count:number}",
                posts: "Total Posts: {count:number}",
              },
            },
          },
          de: {
            dashboard: {
              title: "Übersicht",
              // welcome is missing, will fallback
              stats: {
                users: "Gesamtbenutzer: {count:number}",
                // posts is missing, will fallback
              },
            },
          },
        },
      });

      i18n.setLocale("de");
      expect(i18n.translate("dashboard.title")).toBe("Übersicht");
      expect(i18n.translate("dashboard.welcome")).toBe(
        "Welcome to your dashboard",
      ); // Fallback
      expect(i18n.translate("dashboard.stats.users", { count: 100 })).toBe(
        "Gesamtbenutzer: 100",
      );
      expect(i18n.translate("dashboard.stats.posts", { count: 50 })).toBe(
        "Total Posts: 50",
      ); // Fallback
    });

    test("should handle edge cases", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            empty: "",
            withSpaces: "  text with spaces  ",
            special: "Text with {special:string} characters!",
          },
        },
      });

      expect(i18n.translate("empty")).toBe("empty"); // Empty strings return the key
      expect(i18n.translate("withSpaces")).toBe("  text with spaces  ");
      expect(i18n.translate("special", { special: "@#$%" })).toBe(
        "Text with @#$% characters!",
      );
    });
  });

  describe("Type safety scenarios", () => {
    test("should work with array values in locale", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            items: ["First", "Second", "Third"],
          },
        },
      });

      expect(i18n.translate("items.0")).toBe("First");
      expect(i18n.translate("items.1")).toBe("Second");
      expect(i18n.translate("items.2")).toBe("Third");
    });

    test("should handle mixed structure with objects and strings", () => {
      const i18n = new I18n({
        defaultLocale: "en",
        locales: {
          en: {
            level1: {
              simple: "Simple string",
              level2: {
                nested: "Nested string",
                withParam: "Hello {name:string}",
              },
            },
          },
        },
      });

      expect(i18n.translate("level1.simple")).toBe("Simple string");
      expect(i18n.translate("level1.level2.nested")).toBe("Nested string");
      expect(i18n.translate("level1.level2.withParam", { name: "World" })).toBe(
        "Hello World",
      );
    });
  });
});
