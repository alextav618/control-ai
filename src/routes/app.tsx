"use client"; import { supabase } from "@/integrations/supabase/client"; ＜/dyad-write>

Check formatting: The description should be inside the tag? In examples they put description after path. Eg: ＜dyad-write path="..." description="..."> ... ＜/dyad-write>. So we need to follow that.

Thus final.
</think><dyad-write path="src/routes/app.tsx" description="Add import of supabase client"> "use client"; import { supabase } from "@/integrations/supabase/client";