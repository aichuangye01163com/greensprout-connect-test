import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
CalendarDays,
ChevronRight,
Loader2,
Plus,
Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useGS } from "@/lib/gs-store";
import {
listMyActivities,
type GSEvent,
} from "@/services/activities";

type ActivityTab = "all" | "hosted" | "joined";

type MemberStatus =
| "pending"
| "approved"
| "rejected"
| "cancelled";

export const Route = createFileRoute("/my-activities")({
component: MyActivitiesPage,
});

function MyActivitiesPage() {
const { profile, authEmail } = useGS();

const [events, setEvents] = useState<GSEvent[]>([]);
const [hostedIds, setHostedIds] = useState<string[]>([]);
const [joinedIds, setJoinedIds] = useState<string[]>([]);
const [memberStatuses, setMemberStatuses] = useState<
Record<string, MemberStatus>

>({});
const [tab, setTab] = useState<ActivityTab>("all");
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
let cancelled = false;

async function load() {
  setLoading(true);
  setError(null);

  try {
    const result = await listMyActivities();

    if (cancelled) {
      return;
    }

    setEvents(result.events);
    setHostedIds(result.hostedIds);
    setJoinedIds(result.joinedIds);
    setMemberStatuses(result.memberStatuses);
  } catch (err) {
    console.error("加载我的活动失败:", err);

    if (!cancelled) {
      setError(
        err instanceof Error
          ? err.message
          : "加载我的活动失败"
      );
    }
  } finally {
    if (!cancelled) {
      setLoading(false);
    }
  }
}

load();

return () => {
  cancelled = true;
};

}, []);

const hostedSet = useMemo(
() => new Set(hostedIds),
[hostedIds]
);

const joinedSet = useMemo(
() => new Set(joinedIds),
[joinedIds]
);

const filteredEvents = useMemo(() => {
if (tab === "hosted") {
return events.filter((event) =>
hostedSet.has(event.id)
);
}

if (tab === "joined") {
  /*
   * 业务规则：
   *
   * “我参加的”只显示：
   * 1. 活动状态为 published / confirmed
   * 2. 当前用户报名状态为 pending / approved / rejected
   *
   * cancelled 报名不再显示；
   * completed / cancelled 活动也不再显示。
   *
   * Host 在 activity_members 中也会自动拥有
   * approved membership，因此仍然明确排除
   * 我自己发起的活动。
   */
  return events.filter((event) => {
    const memberStatus = memberStatuses[event.id];

    const isActiveActivity =
      event.status === "published" ||
      event.status === "confirmed";

    const isActiveMembership =
      memberStatus === "pending" ||
      memberStatus === "approved" ||
      memberStatus === "rejected";

    return (
      joinedSet.has(event.id) &&
      !hostedSet.has(event.id) &&
      isActiveActivity &&
      isActiveMembership
    );
  });
}

return events;

}, [
events,
tab,
hostedSet,
joinedSet,
memberStatuses,
]);

const isLoggedIn = Boolean(profile || authEmail);

return (
<div className="min-h-screen bg-background">
<main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
{/* 页面标题 */}
<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
<div>
<h1 className="text-2xl font-bold tracking-tight text-foreground">
我的活动
</h1>

        <p className="mt-1 text-sm text-muted-foreground">
          管理我发起和参加过的活动
        </p>
      </div>

      <Button asChild className="rounded-xl">
        <Link to="/create">
          <Plus className="mr-2 h-4 w-4" />
          发起活动
        </Link>
      </Button>
    </div>

    {/* 未登录 */}
    {!isLoggedIn && !loading && (
      <div className="mt-8 rounded-2xl border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold text-foreground">
          请先登录
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          登录后可以查看和管理你的活动。
        </p>

        <Button asChild className="mt-5 rounded-xl">
          <Link to="/login">登录</Link>
        </Button>
      </div>
    )}

    {/* Tab */}
    {isLoggedIn && (
      <div className="mt-6 flex gap-2 overflow-x-auto border-b">
        <TabButton
          active={tab === "all"}
          onClick={() => setTab("all")}
        >
          全部
        </TabButton>

        <TabButton
          active={tab === "hosted"}
          onClick={() => setTab("hosted")}
        >
          我发起的
        </TabButton>

        <TabButton
          active={tab === "joined"}
          onClick={() => setTab("joined")}
        >
          我参加的
        </TabButton>
      </div>
    )}

    {/* Loading */}
    {loading && (
      <div className="flex min-h-[280px] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载我的活动…
        </div>
      </div>
    )}

    {/* Error */}
    {!loading && error && (
      <div className="mt-8 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">
          {error}
        </p>

        <Button
          variant="outline"
          className="mt-4 rounded-xl"
          onClick={() => {
            window.location.reload();
          }}
        >
          重新加载
        </Button>
      </div>
    )}

    {/* Empty */}
    {!loading &&
      !error &&
      isLoggedIn &&
      filteredEvents.length === 0 && (
        <div className="mt-8 rounded-2xl border bg-card p-10 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground" />

          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {tab === "hosted"
              ? "还没有发起活动"
              : tab === "joined"
                ? "还没有参加活动"
                : "还没有相关活动"}
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            {tab === "hosted"
              ? "创建一个活动，邀请大家一起参加。"
              : tab === "joined"
                ? "去活动大厅看看有没有感兴趣的活动吧。"
                : "发起一个活动，或者去活动大厅参加活动。"}
          </p>

          <div className="mt-5 flex justify-center gap-2">
            <Button asChild className="rounded-xl">
              <Link to="/create">
                发起活动
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="rounded-xl"
            >
              <Link to="/">
                活动大厅
              </Link>
            </Button>
          </div>
        </div>
      )}

    {/* Activity list */}
    {!loading &&
      !error &&
      isLoggedIn &&
      filteredEvents.length > 0 && (
        <div className="mt-6 space-y-3">
          {filteredEvents.map((event) => {
            const isHost = hostedSet.has(event.id);
            const isJoined = joinedSet.has(event.id);

            return (
              <MyActivityCard
                key={event.id}
                event={event}
                isHost={isHost}
                isJoined={isJoined}
                memberStatus={
                  memberStatuses[event.id]
                }
              />
            );
          })}
        </div>
      )}
  </main>
</div>

);
}

function TabButton({
active,
onClick,
children,
}: {
active: boolean;
onClick: () => void;
children: React.ReactNode;
}) {
return (
<button
type="button"
onClick={onClick}
className={[
"whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors",
active
? "border-primary text-foreground"
: "border-transparent text-muted-foreground hover",
].join(" ")}
>
{children}
</button>
);
}

function MyActivityCard({
event,
isHost,
isJoined,
memberStatus,
}: {
event: GSEvent;
isHost: boolean;
isJoined: boolean;
memberStatus?: MemberStatus;
}) {
/*

角色优先级：


host > participant


如果一个用户同时是活动组织者和活动成员，
这里仍然只显示一个角色，并优先显示“组织者”。
*/
const roleLabel = isHost
? "组织者"
: isJoined
? "参与者"
: "";

const registrationStatusLabel =
!isHost && isJoined
? getMemberStatusLabel(memberStatus)
: "";

const activityStatusLabel =
getStatusLabel(event.status);

return (
<article className="overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-sm">
<div className="flex flex-col sm:flex-row">
{/* Cover */}
<div className="h-44 w-full shrink-0 bg-muted sm:h-auto sm:w-48">
{event.cover ? (
<img src={event.cover} alt={event.title} className="h-full w-full object-cover" />
) : (
<div className="flex h-full min-h-44 items-center justify-center">
<CalendarDays className="h-8 w-8 text-muted-foreground" />
</div>
)}
</div>

    {/* Content */}
    <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {roleLabel && (
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            {roleLabel}
          </span>
        )}

        {registrationStatusLabel && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {registrationStatusLabel}
          </span>
        )}

        {activityStatusLabel && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {activityStatusLabel}
          </span>
        )}
      </div>

      <h2 className="mt-3 line-clamp-2 text-lg font-semibold text-foreground">
        {event.title}
      </h2>

      <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" />
          <span>{formatDate(event.startsAt)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {event.location}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {/* 查看活动 */}
        <Button
          asChild
          variant="outline"
          className="rounded-xl"
        >
          <Link
            to="/event/$id"
            params={{ id: event.id }}
          >
            查看活动
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>

        {/* 组织者管理 */}
        {isHost && (
          <Button
            asChild
            className="rounded-xl"
          >
            <Link
              to="/event/$id/manage"
              params={{ id: event.id }}
            >
              活动管理
            </Link>
          </Button>
        )}

        {/* 参与者管理 */}
        {!isHost && isJoined && (
          <Button
            asChild
            className="rounded-xl"
          >
            <Link
              to="/event/$id/manage"
              params={{ id: event.id }}
            >
              管理我的报名
            </Link>
          </Button>
        )}
      </div>
    </div>
  </div>
</article>

);
}

function getMemberStatusLabel(
status?: MemberStatus
): string {
switch (status) {
case "pending":
return "待审核";

case "approved":
  return "已通过";

case "rejected":
  return "被拒绝";

case "cancelled":
  return "已取消";

default:
  return "";

}
}

function getStatusLabel(
status: GSEvent["status"]
): string {
switch (status) {
case "published":
return "已发布";

case "confirmed":
  return "已确认";

case "cancelled":
  return "已取消";

case "completed":
  return "已完成";

default:
  return "";

}
}

function formatDate(value: string): string {
const date = new Date(value);

if (Number.isNaN(date.getTime())) {
return value;
}

return new Intl.DateTimeFormat("zh-CN", {
year: "numeric",
month: "numeric",
day: "numeric",
hour: "2-digit",
minute: "2-digit",
}).format(date);
}
