import "vitest";

declare module "vitest" {
  interface ProvidedContext {
    live: boolean;
  }
}
