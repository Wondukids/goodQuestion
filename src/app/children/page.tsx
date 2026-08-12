import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { AddChildCard, ChildCard } from "@/components/child/child-card";
import { createClient } from "@/lib/supabase/server";
import { selectChild } from "./actions";

export default async function ChildrenPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* RLS(children_own)가 이미 본인 것만 내주지만, 정책이 바뀌어도 새지 않도록 조건을 명시한다. */
  const { data: children, error } = await supabase
    .from("children")
    .select("id, name, birth_year, character_id")
    .eq("parent_id", user.id)
    .order("created_at", { ascending: true });

  /* 나이는 저장하지 않고 birth_year 에서 되돌린다(등록할 때와 같은 기준). */
  const thisYear = new Date().getFullYear();

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-auth-bg px-12 py-8">
      <Logo className="absolute top-[30px] left-12" />

      <div className="flex flex-col items-center gap-20">
        <header className="flex flex-col items-center gap-6 text-center">
          <h1 className="text-[40px] font-extrabold text-ink">
            오늘은 어떤 친구가 함께 할까요~?
          </h1>
          <p className="text-[20px] font-bold text-ink-soft">
            {children?.length
              ? "아이를 선택하면 바로 시작해요"
              : "아직 등록된 아이가 없어요. 먼저 아이를 등록해 주세요"}
          </p>
          {error && (
            <p role="alert" className="text-[16px] font-bold text-[#d94b4b]">
              아이 목록을 불러오지 못했어요. {error.message}
            </p>
          )}
        </header>

        <div className="flex h-[431px] items-start gap-10">
          {children?.map((child) => (
            <ChildCard
              key={child.id}
              name={child.name}
              age={thisYear - child.birth_year}
              characterId={child.character_id}
              action={selectChild.bind(null, child.id)}
            />
          ))}
          <AddChildCard href="/onboarding/child" />
        </div>
      </div>
    </main>
  );
}
