import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
ArrowLeft,
Check,
Clock,
MessageCircle,
UserRound,
X,
} from "lucide-react";

import { AppShell } from "@/components/gs/AppShell";
import { useGS } from "@/lib/gs-store";
import { supabase } from "@/integrations/supabase/client";
import {
approveMember,
cancelActivity,
confirmActivity,
getActivity,
getApprovedMembers,
getPendingMembers,
leaveActivity,
rejectMember,
type ApprovedActivityMember,
type PendingActivityMember,
} from "@/services/activities";

export const Route = createFileRoute("/event/$id/manage")({
component: EventManagePage,
});

function EventManagePage() {
const { id } = Route.useParams();

const { refresh, authReady, profile } = useGS();

const [event, setEvent] =
useState<Awaited<ReturnType<typeof getActivity>>>(null);

const [currentUserId, setCurrentUserId] = useState<string | null>(null);

const [pendingMembers, setPendingMembers] = useState<
  PendingActivityMember[]
>([]);

const [approvedMembers, setApprovedMembers] = useState<
  ApprovedActivityMember[]
>([]);

const [myMembershipStatus, setMyMembershipStatus] = useState<
  "pending" | "approved" | "rejected" | "cancelled" | null
>(null);

const [loading, setLoading] = useState(true);
const [actionLoading, setActionLoading] = useState(false);
const [errorMessage, setErrorMessage] = useState<string | null>(null);

useEffect(() => {
let cancelled = false;

if (!authReady) {
  return () => {
    cancelled = true;
  };
}

async function loadPage() {
  setLoading(true);
  setErrorMessage(null);

  try {
    const userId = profile?.id;

    if (!userId) {
      setCurrentUserId(null);
      setEvent(null);
      setLoading(false);
      return;
    }

    setCurrentUserId(userId);

    // 管理页直接从 Supabase 获取活动。
    // 不再依赖 gs-store.events，避免首次进入页面时
    // store 尚未完成异步加载而误显示“活动不存在”。
    const activity = await getActivity(id);

    if (cancelled) return;

    setEvent(activity);

    if (!activity) {
      setMyMembershipStatus(null);
      setPendingMembers([]);
      setApprovedMembers([]);
      setLoading(false);
      return;
    }

    const { data: membership, error: membershipError } =
      await supabase
        .from("activity_members")
        .select("status")
        .eq("activity_id", id)
        .eq("user_id", userId)
        .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (cancelled) return;

    setMyMembershipStatus(
      membership?.status ?? null
    );

    if (userId === activity.hostId) {
      const [pending, approved] = await Promise.all([
        getPendingMembers(id),
        getApprovedMembers(id),
      ]);

      if (cancelled) return;

      setPendingMembers(pending);
      setApprovedMembers(approved);
    } else {
      setPendingMembers([]);
      setApprovedMembers([]);
    }
  } catch (error) {
    console.error("加载活动管理页失败:", error);

    if (!cancelled) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "加载活动管理页失败"
      );
    }
  } finally {
    if (!cancelled) {
      setLoading(false);
    }
  }
}

loadPage();

return () => {
  cancelled = true;
};

}, [id, authReady, profile?.id]);

if (!event && loading) {
return (
<AppShell>
<main className="mx-auto max-w-3xl px-4 py-8">
<Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" >
<ArrowLeft className="h-4 w-4" />
返回活动大厅
</Link>

      <div className="mt-8 rounded-2xl border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          正在加载活动……
        </p>
      </div>
    </main>
  </AppShell>
);

}

if (!event) {
return (
<AppShell>
<main className="mx-auto max-w-3xl px-4 py-8">
<Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" >
<ArrowLeft className="h-4 w-4" />
返回活动大厅
</Link>

      <div className="mt-8 rounded-2xl border bg-card p-6 text-center">
        <p className="text-muted-foreground">
          活动不存在或者暂时无法加载。
        </p>
      </div>
    </main>
  </AppShell>
);

}

const isHost = currentUserId === event.hostId;

async function reloadManagementData() {
if (!currentUserId) return;

const activity = await getActivity(id);

if (!activity) {
  setEvent(null);
  return;
}

setEvent(activity);

const { data: membership, error: membershipError } =
  await supabase
    .from("activity_members")
    .select("status")
    .eq("activity_id", id)
    .eq("user_id", currentUserId)
    .maybeSingle();

if (membershipError) {
  throw membershipError;
}

setMyMembershipStatus(
  membership?.status ?? null
);

if (currentUserId === activity.hostId) {
  const [pending, approved] = await Promise.all([
    getPendingMembers(id),
    getApprovedMembers(id),
  ]);

  setPendingMembers(pending);
  setApprovedMembers(approved);
} else {
  setPendingMembers([]);
  setApprovedMembers([]);
}

}

async function handleApprove(memberId: string) {
setActionLoading(true);
setErrorMessage(null);

try {
  await approveMember(memberId);
  await reloadManagementData();
} catch (error) {
  console.error("通过报名失败:", error);

  setErrorMessage(
    error instanceof Error
      ? error.message
      : "通过报名失败"
  );
} finally {
  setActionLoading(false);
}

}

async function handleReject(memberId: string) {
setActionLoading(true);
setErrorMessage(null);

try {
  await rejectMember(memberId);
  await reloadManagementData();
} catch (error) {
  console.error("拒绝报名失败:", error);

  setErrorMessage(
    error instanceof Error
      ? error.message
      : "拒绝报名失败"
  );
} finally {
  setActionLoading(false);
}

}

async function handleConfirm() {
setActionLoading(true);
setErrorMessage(null);

try {
  await confirmActivity(id);
  await refresh();
  await reloadManagementData();
} catch (error) {
  console.error("确认活动失败:", error);

  setErrorMessage(
    error instanceof Error
      ? error.message
      : "确认活动失败"
  );
} finally {
  setActionLoading(false);
}

}

async function handleCancelActivity() {
const confirmed = window.confirm(
"确定要取消这个活动吗？取消后活动将无法继续进行。"
);

if (!confirmed) return;

setActionLoading(true);
setErrorMessage(null);

try {
  await cancelActivity(id);
  await refresh();
  await reloadManagementData();
} catch (error) {
  console.error("取消活动失败:", error);

  setErrorMessage(
    error instanceof Error
      ? error.message
      : "取消活动失败"
  );
} finally {
  setActionLoading(false);
}

}

async function handleLeaveActivity() {
const confirmed = window.confirm(
"确定要取消自己的报名吗？"
);

if (!confirmed) return;

setActionLoading(true);
setErrorMessage(null);

try {
  await leaveActivity(id);
  await refresh();
  await reloadManagementData();
} catch (error) {
  console.error("取消报名失败:", error);

  setErrorMessage(
    error instanceof Error
      ? error.message
      : "取消报名失败"
  );
} finally {
  setActionLoading(false);
}

}

const statusLabel: Record<string, string> = {
published: "报名中",
confirmed: "活动已确认",
cancelled: "活动已取消",
completed: "活动已结束",
};

const memberStatusLabel: Record<string, string> = {
pending: "等待审核",
approved: "已通过",
rejected: "被拒绝",
cancelled: "已取消",
};

const isPublished = event.status === "published";
const isConfirmed = event.status === "confirmed";
const isCancelled = event.status === "cancelled";
const isCompleted = event.status === "completed";

// Host 虽然自动拥有 approved membership，但不属于参加人数。
// 管理页只展示真正的参加成员，且人数按 participant_limit 统计。
const participantMembers = approvedMembers.filter(
  (member) => member.userId !== event.hostId,
);

return (
<AppShell>
<main className="mx-auto max-w-3xl px-4 py-6 pb-12">
{/* 顶部返回 */}
<div className="mb-5">
<Link
to="/event/$id"
params={{ id }}
className="inline-flex items-center gap-2 text-sm text-muted-foreground hover"
>
<ArrowLeft className="h-4 w-4" />
返回活动详情
</Link>
</div>

    {/* 活动基本信息 */}
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">
            活动管理
          </h1>

          <p className="mt-2 text-xs font-mono text-muted-foreground">
            MANAGE-V2-98D5
          </p>

          <p className="mt-2 text-base font-medium">
            {event.title}
          </p>
        </div>

        <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs">
          {statusLabel[event.status] ?? event.status}
        </span>
      </div>

      <div className="mt-4 space-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <span>
            {new Date(event.startsAt).toLocaleString(
              "zh-CN"
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4" />
          <span>
            组织者：{event.host.name}
          </span>
        </div>
      </div>
    </section>

    {errorMessage && (
      <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {errorMessage}
      </div>
    )}

    {loading ? (
      <div className="mt-6 rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
        正在加载管理信息……
      </div>
    ) : isHost ? (
      <>
        {/* =========================
            组织者区域
           ========================= */}

        <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold">
            活动管理
          </h2>

          <div className="mt-4 space-y-3">
            {isPublished && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={actionLoading}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {actionLoading
                  ? "处理中……"
                  : "确认活动并开启群聊"}
              </button>
            )}

            {isConfirmed && (
              <Link
                to="/event/$id"
                params={{ id }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium hover:bg-muted"
              >
                <MessageCircle className="h-4 w-4" />
                进入活动群聊
              </Link>
            )}

            {!isCancelled && !isCompleted && (
              <button
                type="button"
                onClick={handleCancelActivity}
                disabled={actionLoading}
                className="w-full rounded-xl border border-destructive/40 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
              >
                取消活动
              </button>
            )}
          </div>
        </section>

        {/* 成员管理 */}
        <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                成员管理
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                管理报名申请，并查看已通过的参加成员。
              </p>
            </div>

            <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs">
              {participantMembers.length} / {event.participantLimit}
            </span>
          </div>

          <div className="mt-5">
        {/* 待审核报名 */}
        <section className="rounded-xl border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              待审核报名
            </h2>

            <span className="rounded-full bg-muted px-3 py-1 text-xs">
              {pendingMembers.length} 人
            </span>
          </div>

          {pendingMembers.length === 0 ? (
            <div className="mt-5 rounded-xl bg-muted/50 p-5 text-center text-sm text-muted-foreground">
              暂时没有待审核报名
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {pendingMembers.map((member) => (
                <div
                  key={member.id}
                  className="rounded-xl border p-4"
                >
                  <div className="flex items-start gap-3">
                    {member.profile?.avatarUrl ? (
                      <img
                        src={member.profile.avatarUrl}
                        alt=""
                        className="h-11 w-11 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted">
                        <UserRound className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {member.profile?.nickname ||
                          "GreenSprout 用户"}
                      </p>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {memberStatusLabel[member.status]}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleApprove(member.id)
                      }
                      disabled={actionLoading}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                      通过
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleReject(member.id)
                      }
                      disabled={actionLoading}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                      拒绝
                    </button>
                  </div>

                  <Link
                    to="/profile"
                    className="mt-3 block text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    查看个人资料
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 已通过成员 */}
        <section className="mt-4 rounded-xl border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              已通过成员
            </h2>

            <span className="rounded-full bg-muted px-3 py-1 text-xs">
              {participantMembers.length} / {event.participantLimit} 人
            </span>
          </div>

          {participantMembers.length === 0 ? (
            <div className="mt-5 rounded-xl bg-muted/50 p-5 text-center text-sm text-muted-foreground">
              暂时还没有已通过的参加成员
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {participantMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 rounded-xl border p-4"
                >
                  {member.profile?.avatarUrl ? (
                    <img
                      src={member.profile.avatarUrl}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      <UserRound className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {member.profile?.nickname ||
                        "GreenSprout 用户"}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      已通过
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
          </div>
        </section>
      </>
    ) : (
      <>
        {/* =========================
            参与者区域
           ========================= */}

        <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold">
            我的报名
          </h2>

          <div className="mt-4 rounded-xl bg-muted/50 p-4">
            {myMembershipStatus ? (
              <>
                <p className="font-medium">
                  {memberStatusLabel[myMembershipStatus] ??
                    myMembershipStatus}
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {myMembershipStatus === "pending" &&
                    "你的报名已经提交，请等待组织者审核。"}

                  {myMembershipStatus === "approved" &&
                    "你已经通过审核，可以进入活动群聊。"}

                  {myMembershipStatus === "rejected" &&
                    "组织者暂未通过你的报名。"}

                  {myMembershipStatus === "cancelled" &&
                    "你已经取消了本次报名。"}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  暂无报名记录
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  当前账号没有这场活动的报名记录。
                </p>
              </>
            )}
          </div>

          {myMembershipStatus === "approved" &&
            isConfirmed && (
              <Link
                to="/event/$id"
                params={{ id }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
              >
                <MessageCircle className="h-4 w-4" />
                进入活动群聊
              </Link>
            )}

          {(myMembershipStatus === "pending" ||
            myMembershipStatus === "approved" ||
            myMembershipStatus === "rejected") &&
            !isCancelled &&
            !isCompleted && (
              <button
                type="button"
                onClick={handleLeaveActivity}
                disabled={actionLoading}
                className="mt-3 w-full rounded-xl border border-destructive/40 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
              >
                {actionLoading
                  ? "处理中……"
                  : "取消我的报名"}
              </button>
            )}
        </section>
      </>
    )}

    {/* 返回活动详情 */}
    <div className="mt-6">
      <Link
        to="/event/$id"
        params={{ id }}
        className="flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-medium hover:bg-muted"
      >
        返回活动详情
      </Link>
    </div>
  </main>
</AppShell>

);
}
