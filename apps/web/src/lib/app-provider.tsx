// Extension point for app-wide providers (theme, auth, etc.) — wraps every route via
// the router's `Wrap` option.
export function AppProviders({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
