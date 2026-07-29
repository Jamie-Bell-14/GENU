/**
 * Supabase connection configuration. Only the URL and the publishable key
 * exist client-side.
 *
 * The elevated key is not read here. It is read by one server-only module,
 * `src/lib/services/trusted-writer.ts`, so that "which code can write history"
 * is answerable by looking at a single file.
 */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
