# Field Notes product setup

1. Create a Supabase project.
2. Run `supabase/migrations/202608160001_field_notes_product.sql` with the Supabase CLI or SQL editor.
3. In Google Auth Platform, create a Web OAuth client and add the callback URL shown by Supabase.
4. Enable Google under Supabase Authentication > Providers.
5. Add the exact local and production URLs under Authentication > URL Configuration.
6. Copy `.env.example` to `.env.local` and add the project URL and publishable key.

Never put the service-role key in this browser application. The publishable key is safe to expose only because every product table is protected by Row Level Security.
