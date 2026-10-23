/* Which Supabase project the app talks to. The publishable (anon) key is meant to be public:
   row level security in the database decides what each device may read and write.
   These values are the local development stack (npx supabase start); replace them with your
   project's URL and publishable key from Project Settings → API before publishing. */
export default {
  supabaseUrl: "http://127.0.0.1:57321",
  supabaseKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
};
