import {
createFileRoute,
Link,
} from "@tanstack/react-router";

import {
useEffect,
useRef,
useState,
} from "react";

import {
ChevronLeft,
MapPin,
Clock,
Users,
ShieldCheck,
Send,
Lock,
} from "lucide-react";

import { AppShell } from "@/components/gs/AppShell";
import { Tag } from "@/components/gs/Chip";
import { Countdown } from "@/components/gs/Countdown";
import { InviteCard } from "@/components/gs/InviteCard";

import { useGS } from "@/lib/gs-store";

import {
confirmActivity,
} from "@/services/activities";

import {
getChatRoom,
sendMessage,
DISSOLVE_HOURS_AFTER_END,
type ChatRoom,
} from "@/services/chat";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute(
"/event/$id"
)({
component: EventDetailPage,
});

function EventDetailPage() {

const {
events,
join,
refresh,
membershipStatuses,
} = useGS();

const { id } = Route.useParams();

const event =
events.find(
(item) => item.id === id
) ?? null;

/*

* 当前登录用户
  */
  const [
  currentUserId,
  setCurrentUserId,
  ] = useState<string | null>(null);

/*

* 报名
*
* 这里只处理“没有报名记录”的立即报名。
* rejected / cancelled 不再通过详情页重新报名。
  */
  const [
  joining,
  setJoining,
  ] = useState(false);

/*

* 组织者确认活动
*
* 注意：
* 这里保留底层函数和状态，
* 但详情页不再提供组织者确认按钮。
*
* 组织者统一进入：
* /event/:id/manage
  */
  const [
  confirmingActivity,
  setConfirmingActivity,
  ] = useState(false);

/*

* 聊天
  */
  const [
  room,
  setRoom,
  ] = useState<ChatRoom | null>(null);

const [
message,
setMessage,
] = useState("");

const [
sending,
setSending,
] = useState(false);

const chatEndRef =
useRef<HTMLDivElement | null>(null);

/*

* 获取当前用户
  */
  useEffect(() => {


let mounted = true;



supabase.auth
  .getUser()
  .then(({ data }) => {

    if (mounted) {
      setCurrentUserId(
        data.user?.id ?? null
      );
    }

  });

return () => {
  mounted = false;
};


}, []);

/*

* 是否为活动组织者
  */
  const isHost =
  !!currentUserId &&
  !!event?.hostId &&
  currentUserId === event.hostId;

/*

* 当前用户对本活动的报名状态
*
* 注意：
* Host 虽然会自动存在 activity_members，
* 但 Host 不能被当作普通参与者。
  */
  const membershipStatus =
  event
  ? membershipStatuses[event.id]
  : undefined;

/*

* 只有 approved 才算普通参与者已经报名成功。
*
* Host 不属于普通参与者。
  */
  const joined =
  !!event &&
  !isHost &&
  membershipStatus === "approved";

/*

* 活动是否已经结束
*
* cancelled = 活动取消
* completed = 活动正常结束
  */
  const ended =
  event?.status === "cancelled" ||
  event?.status === "completed";

/*

* 是否已经确认
  */
  const confirmed =
  event?.status === "confirmed";

/*

* 加载聊天
*
* 注意：
* 不把 membershipStatus 放进 dependency。
* 避免报名状态变化与 Chat/Auth 请求发生耦合。
  */
  useEffect(() => {


if (!event) {



  return;
}

void getChatRoom(
  event.id
).then(
  setRoom
);


}, [
event?.id,
event?.joined,
event?.status,
]);

/*

* 自动滚动到最新消息
  */
  useEffect(() => {


chatEndRef.current?.scrollIntoView({



  behavior: "smooth",
});


}, [
room?.messages.length,
]);

/*

* 立即报名
*
* 这里只用于没有报名记录的普通用户。
*
* rejected / cancelled 不再从详情页重新报名。
  */
  const startJoin =
  async () => {

  if (!event) {
  return;
  }

  setJoining(true);

  try {

  await join(
  event.id
  );

  } catch (error) {

  console.error(
  "报名失败:",
  error
  );

  } finally {

  setJoining(false);

  }
  };

/*

* 组织者确认活动
*
* 当前详情页不再提供这个按钮。
*
* 保留这个函数是为了避免改变已经跑通的业务链，
* 后续可以在需要时完全移除。
  */
  const doConfirmActivity =
  async () => {

  if (
  !event ||
  !isHost ||
  event.status !== "published" ||
  confirmingActivity
  ) {
  return;
  }

  setConfirmingActivity(true);

  try {

  await confirmActivity(
  event.id
  );

  /*
  * 刷新全局活动状态。
  *
  * published → confirmed
  */
  await refresh();

  /*
  * 重新读取聊天室状态。
  */
  const updatedRoom =
  await getChatRoom(
  event.id
  );

  setRoom(
  updatedRoom
  );

  } catch (error) {

  console.error(
  "确认活动失败:",
  error
  );

  window.alert(
  "确认活动失败，请稍后重试"
  );

  } finally {

  setConfirmingActivity(false);

  }
  };

/*

* 发送聊天消息
  */
  const handleSendMessage =
  async () => {

  if (
  !event ||
  !message.trim() ||
  sending
  ) {
  return;
  }

  setSending(true);

  try {

  const newMessage =
  await sendMessage(
  event.id,
  message.trim()
  );

  setRoom(
  (current) => {

  
     if (!current) {
       return current;
     }

     return {
       ...current,
       messages: [
         ...current.messages,
         newMessage,
       ],
     };

   }
  

  );

  setMessage("");

  } catch (error) {

  console.error(
  "发送消息失败:",
  error
  );

  window.alert(
  "发送消息失败，请稍后重试"
  );

  } finally {

  setSending(false);

  }
  };

/*

* Enter 发送消息
  */
  const handleMessageKeyDown =
  (
  e: React.KeyboardEvent<HTMLInputElement>
  ) => {

  if (
  e.key === "Enter" &&
  !e.shiftKey
  ) {

  e.preventDefault();

  void handleSendMessage();

  }
  };

/*

* 活动不存在
  */
  if (!event) {


return (



  <AppShell>

    <div className="p-6">

      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm"
      >
        <ChevronLeft size={18} />
        返回活动列表
      </Link>

      <div className="mt-10 text-center">
        活动不存在或已被删除
      </div>

    </div>

  </AppShell>
);


}

/*

* 私密活动
  */
  const privateEvent =
  event.isPrivate;

/*

* 群聊是否已经解锁
  */
  const chatUnlocked =
  room?.unlocked === true;

/*

* 活动结束后的群聊解散时间
  */
  const dissolveAt =
  event.endsAt
  ? new Date(
  new Date(
  event.endsAt
  ).getTime() +
  DISSOLVE_HOURS_AFTER_END *
  60 *
  60 *
  1000
  )
  : null;

return ( <AppShell>


  <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 md:px-6">

    {/* 返回 */}
    <div className="mb-4">

      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={18} />
        返回活动列表
      </Link>

    </div>


    {/* 活动主体 */}
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">


      {/* 左侧 */}
      <div className="space-y-6">


        {/* 封面 */}
        <div className="overflow-hidden rounded-3xl bg-muted">

          <img
            src={event.cover}
            alt={event.title}
            className="aspect-[16/9] w-full object-cover"
          />

        </div>


        {/* 标题 */}
        <div>

          <div className="mb-3 flex flex-wrap gap-2">

            <Tag>
              {event.category}
            </Tag>

            {privateEvent && (
              <Tag>
                <Lock
                  size={13}
                  className="mr-1"
                />
                私密活动
              </Tag>
            )}

            {confirmed && (
              <Tag>
                已确认
              </Tag>
            )}

            {event.status === "cancelled" && (
              <Tag>
                已取消
              </Tag>
            )}

            {event.status === "completed" && (
              <Tag>
                已结束
              </Tag>
            )}

          </div>


          <h1 className="text-2xl font-semibold md:text-3xl">
            {event.title}
          </h1>


          <div className="mt-4 space-y-3 text-sm text-muted-foreground">

            <div className="flex items-center gap-2">
              <Clock size={17} />
              <span>
                {new Date(
                  event.startsAt
                ).toLocaleString()}
              </span>
            </div>


            <div className="flex items-center gap-2">
              <MapPin size={17} />
              <span>
                {event.location}
              </span>
            </div>


            <div className="flex items-center gap-2">
              <Users size={17} />
              <span>
                {event.limit} 人
              </span>
            </div>

          </div>

        </div>


        {/* 倒计时 */}
        {!ended && (
          <Countdown
            startsAt={
              event.startsAt
            }
            ended={ended}
          />
        )}


        {/* 活动介绍 */}
        <section>

          <h2 className="mb-3 text-lg font-semibold">
            活动介绍
          </h2>

          <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
            {event.description}
          </p>

        </section>


        {/* 组织者信息 */}
        <section className="rounded-2xl border p-4">

          <div className="flex items-center gap-3">

            {event.host.avatar ? (
              <img
                src={event.host.avatar}
                alt={event.host.name}
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                {event.host.name?.slice(
                  0,
                  1
                )}
              </div>
            )}

            <div>

              <div className="font-medium">
                {event.host.name}
              </div>

              <div className="text-xs text-muted-foreground">
                活动组织者
              </div>

            </div>

          </div>

        </section>


        {/* =====================================================
         * 活动管理入口
         *
         * 组织者 / 已有报名记录的参与者
         * 统一进入独立管理页。
         * ===================================================== */}
        {(isHost || !!membershipStatus) && (
          <section className="rounded-2xl border-2 border-primary/20 bg-primary/[0.03] p-5">

            <div className="flex items-start gap-3">

              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">

                <ShieldCheck
                  size={20}
                  className="text-primary"
                />

              </div>

              <div className="min-w-0 flex-1">

                <h2 className="text-lg font-semibold">
                  活动管理
                </h2>

                <p className="mt-1 text-sm leading-6 text-muted-foreground">

                  {isHost
                    ? "管理报名申请、确认或取消活动，并查看已通过成员。"
                    : membershipStatus === "pending"
                      ? "你的报名正在等待组织者审核。"
                      : membershipStatus === "approved"
                        ? "查看你的报名状态，并在需要时管理自己的报名。"
                        : membershipStatus === "rejected"
                          ? "你的报名被组织者拒绝，可以查看报名状态或取消报名。"
                          : "你的报名已经取消，可以查看报名状态。"}

                </p>

                <Link
                  to="/event/$id/manage"
                  params={{ id: event.id }}
                  className="mt-4 inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
                >
                  {isHost
                    ? "进入活动管理"
                    : "管理我的报名"}

                </Link>

              </div>

            </div>

          </section>
        )}


        {/* =====================================================
         * 活动群聊
         *
         * 注意：
         * 本阶段不修改 chat.ts。
         * ===================================================== */}
        <section className="rounded-2xl border p-4">

          <div className="mb-4 flex items-center justify-between">

            <div>

              <h2 className="font-semibold">
                活动群聊
              </h2>

              <p className="mt-1 text-xs text-muted-foreground">

                {confirmed
                  ? `活动结束 ${DISSOLVE_HOURS_AFTER_END} 小时后群聊自动关闭`
                  : "活动确认后，审核通过的成员可以进入群聊"}

              </p>

            </div>

            {chatUnlocked && (
              <ShieldCheck
                size={19}
                className="text-muted-foreground"
              />
            )}

          </div>


          {/* =================================================
           * 未确认
           * ================================================= */}
          {!confirmed ? (

            <div className="rounded-xl border bg-muted/30 p-5">

              <div className="flex items-start gap-3">

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background">

                  <Lock
                    size={18}
                  />

                </div>


                <div className="min-w-0 flex-1">

                  <div className="text-sm font-semibold">

                    {isHost
                      ? "活动尚未确认"
                      : "等待组织者确认活动"}

                  </div>


                  <div className="mt-1 text-xs leading-5 text-muted-foreground">

                    {isHost
                      ? "请进入活动管理页确认活动。确认后，审核通过的成员即可进入活动群聊。"
                      : "组织者确认活动后，审核通过的成员即可进入活动群聊。"}

                  </div>


                  {/* 组织者进入管理页 */}
                  {isHost &&
                    event.status === "published" && (
                      <Link
                        to="/event/$id/manage"
                        params={{ id: event.id }}
                        className="mt-4 inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                      >
                        进入活动管理
                      </Link>
                    )}

                </div>

              </div>

            </div>


          ) : !chatUnlocked ? (

            /* =================================================
             * 已确认，但当前用户暂时没有群聊权限
             * ================================================= */
            <div className="rounded-xl bg-muted/50 p-4">

              <div className="flex items-start gap-3">

                <Lock
                  size={18}
                  className="mt-0.5 shrink-0"
                />

                <div>

                  <div className="text-sm font-medium">

                    暂时无法进入群聊

                  </div>

                  <div className="mt-1 text-xs leading-5 text-muted-foreground">

                    {isHost
                      ? "活动已确认，但当前账号暂时没有群聊访问权限。"
                      : "审核通过后即可进入活动群聊。"}

                  </div>

                </div>

              </div>

            </div>


          ) : (

            /* =================================================
             * 群聊已开启
             * ================================================= */
            <>

              <div className="mb-4 rounded-xl bg-muted/30 px-4 py-3">

                <div className="flex items-center gap-2">

                  <ShieldCheck
                    size={16}
                    className="text-primary"
                  />

                  <span className="text-sm font-medium">
                    群聊已开启
                  </span>

                </div>

                <div className="mt-1 text-xs text-muted-foreground">
                  {isHost
                    ? "你是活动组织者，可以与已审核成员交流。"
                    : "你已获得活动群聊访问权限。"}
                </div>

              </div>


              <div className="max-h-80 space-y-3 overflow-y-auto pr-1">

                {room?.messages?.length ? (

                  room.messages.map(
                    (item) => (

                      <div
                        key={item.id}
                        className="flex gap-3"
                      >

                        {item.avatarUrl ? (

                          <img
                            src={item.avatarUrl}
                            alt={item.nickname}
                            className="h-8 w-8 shrink-0 rounded-full object-cover"
                          />

                        ) : (

                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
                            {item.nickname?.slice(
                              0,
                              1
                            )}
                          </div>

                        )}

                        <div className="min-w-0">

                          <div className="text-xs text-muted-foreground">
                            {item.nickname}
                          </div>

                          <div className="mt-1 rounded-xl bg-muted px-3 py-2 text-sm">
                            {item.text}
                          </div>

                        </div>

                      </div>

                    )

                  )

                ) : (

                  <div className="py-8 text-center text-sm text-muted-foreground">
                    群里还没有消息
                  </div>

                )}

                <div
                  ref={
                    chatEndRef
                  }
                />

              </div>


              <div className="mt-4 flex gap-2">

                <input
                  value={message}
                  onChange={(e) =>
                    setMessage(
                      e.target.value
                    )
                  }
                  onKeyDown={
                    handleMessageKeyDown
                  }
                  placeholder="输入消息…"
                  disabled={sending}
                  className="min-w-0 flex-1 rounded-full border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />

                <button
                  type="button"
                  onClick={() =>
                    void handleSendMessage()
                  }
                  disabled={
                    sending ||
                    !message.trim()
                  }
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
                >
                  <Send size={17} />
                </button>

              </div>


              {dissolveAt && (
                <div className="mt-3 text-center text-xs text-muted-foreground">
                  活动结束后约{" "}
                  {DISSOLVE_HOURS_AFTER_END}
                  {" "}小时自动关闭群聊
                </div>
              )}

            </>

          )}

        </section>


        {/* 私密活动邀请 */}
        {privateEvent && (
          <InviteCard
            event={event}
          />
        )}

      </div>


      {/* =====================================================
       * 右侧
       * ===================================================== */}
      <aside className="space-y-4">

        <div className="rounded-2xl border p-5">

          <h2 className="font-semibold">
            活动信息
          </h2>

          <div className="mt-4 space-y-3 text-sm">

            <div className="flex items-center justify-between">

              <span className="text-muted-foreground">
                人数上限
              </span>

              <span>
                {event.limit}
              </span>

            </div>


            <div className="flex items-center justify-between">

              <span className="text-muted-foreground">
                活动费用
              </span>

              <span>
                {event.fee > 0
                  ? `¥${event.fee}`
                  : "免费"}
              </span>

            </div>


            <div className="flex items-center justify-between">

              <span className="text-muted-foreground">
                押金
              </span>

              <span>
                {event.deposit > 0
                  ? `¥${event.deposit}`
                  : "无"}
              </span>

            </div>

          </div>

        </div>


        {event.agenda?.length > 0 && (

          <div className="rounded-2xl border p-5">

            <h2 className="font-semibold">
              活动流程
            </h2>

            <div className="mt-4 space-y-4">

              {event.agenda.map(
                (item, index) => (

                  <div
                    key={`${item.time}-${index}`}
                    className="flex gap-3"
                  >

                    <div className="w-14 shrink-0 text-xs text-muted-foreground">
                      {item.time}
                    </div>

                    <div className="text-sm">
                      {item.text}
                    </div>

                  </div>

                )
              )}

            </div>

          </div>

        )}

      </aside>

    </div>


    {/* =======================================================
     * 底部操作栏
     *
     * 组织者：
     * → 进入活动管理
     *
     * pending：
     * → 管理我的报名
     *
     * approved：
     * → 管理我的报名
     *
     * rejected / cancelled：
     * → 管理我的报名
     *
     * 无报名记录：
     * → 立即报名
     * ======================================================= */}
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">

      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-6">

        <div className="min-w-0">

          <div className="truncate text-sm font-medium">
            {event.title}
          </div>

          <div className="text-xs text-muted-foreground">

            {isHost
              ? event.status === "published"
                ? "活动等待组织者确认"
                : event.status === "confirmed"
                  ? "活动已确认 · 群聊已开启"
                  : event.status === "cancelled"
                    ? "活动已取消"
                    : event.status === "completed"
                      ? "活动已结束"
                      : ""
              : membershipStatus === "pending"
                ? "你的报名正在等待审核"
                : membershipStatus === "approved"
                  ? "你已通过报名审核"
                  : membershipStatus === "rejected"
                    ? "你的报名未通过审核"
                    : membershipStatus === "cancelled"
                      ? "你的报名已取消"
                      : "欢迎报名参加"}

          </div>

        </div>


        {ended ? (

          <button
            type="button"
            disabled
            className="rounded-full bg-muted px-6 py-2.5 text-sm font-medium text-muted-foreground"
          >
            {event.status === "cancelled"
              ? "活动已取消"
              : "活动已结束"}
          </button>


        ) : isHost ? (

          <Link
            to="/event/$id/manage"
            params={{ id: event.id }}
            className="rounded-full bg-primary px-7 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm"
          >
            活动管理
          </Link>


        ) : membershipStatus === "pending" ? (

          <Link
            to="/event/$id/manage"
            params={{ id: event.id }}
            className="rounded-full border px-6 py-2.5 text-sm font-medium"
          >
            等待审核
          </Link>


        ) : membershipStatus === "approved" ? (

          <Link
            to="/event/$id/manage"
            params={{ id: event.id }}
            className="rounded-full border px-6 py-2.5 text-sm font-medium"
          >
            管理我的报名
          </Link>


        ) : membershipStatus === "rejected" ? (

          <Link
            to="/event/$id/manage"
            params={{ id: event.id }}
            className="rounded-full border px-6 py-2.5 text-sm font-medium"
          >
            管理我的报名
          </Link>


        ) : membershipStatus === "cancelled" ? (

          <Link
            to="/event/$id/manage"
            params={{ id: event.id }}
            className="rounded-full border px-6 py-2.5 text-sm font-medium"
          >
            管理我的报名
          </Link>


        ) : (

          <button
            type="button"
            onClick={() =>
              void startJoin()
            }
            disabled={joining}
            className="rounded-full bg-primary px-7 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {joining
              ? "报名中…"
              : "立即报名"}
          </button>

        )}

      </div>

    </div>

  </div>

</AppShell>


);
}
