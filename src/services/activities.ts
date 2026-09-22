/**
 * 活动领域服务：UI 只依赖这些异步接口。
 *
 * Phase 1 核心原则：
 *
 * 1. activities.ts 负责活动 / 报名业务数据访问
 * 2. membership 状态统一使用 ActivityMemberStatus
 * 3. Store 不再自己猜测报名状态
 * 4. join / cancel 返回统一的 ActivityMutationResult
 * 5. joinedIds 仅作为旧页面兼容接口
 */ 

import { supabase } from "@/integrations/supabase/client";
import { mapActivityToEvent } from "./activity-mapper";

import {
  CATEGORY_MAP,
  TIME_RANGES,
  daysFromNow,
  makeInviteToken,
  type CategoryId,
  type GSEvent,
  type TimeRangeId,
} from "@/data/greensprout";

export interface ActivityQuery {
  timeRange?: TimeRangeId;
  categories?: CategoryId[];
  keyword?: string;
}

/**
 * 当前用户在活动中的报名状态。
 *
 * pending   = 待审核
 * approved  = 已通过
 * rejected  = 未通过
 * cancelled = 已取消
 */
export type ActivityMemberStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

/**
 * 报名相关操作的统一返回结构。
 *
 * joinActivity()
 * cancelActivity()
 *
 * 都使用这个结构，避免 Store 与 Service
 * 出现返回值不一致。
 */
export interface ActivityMutationResult {
  event: GSEvent;
  membershipStatus: ActivityMemberStatus;
}

/**
 * 获取活动列表。
 */
export async function listActivities(
  query: ActivityQuery = {},
): Promise<GSEvent[]> {
  const { data, error } = await supabase
    .from("activities")
    .select(`
      *,
      activity_categories (
        id,
        name,
        slug
      ),
      profiles (
        id,
        nickname,
        avatar_url
      )
    `)
    .order("starts_at", {
      ascending: true,
    });

  if (error) {
    console.error(
      "获取活动失败:",
      error,
    );
    throw error;
  }

  const events = (data ?? []).map(
    (item) => mapActivityToEvent(item),
  );

  return filterActivities(events, query);
}

/**
 * 前端筛选逻辑。
 */
export function filterActivities(
  events: GSEvent[],
  query: ActivityQuery,
): GSEvent[] {
  const range = TIME_RANGES.find(
    (r) => r.id === query.timeRange,
  );

  return events
    .filter((e) => {
      if (range) {
        const d = daysFromNow(
          e.startsAt,
        );

        if (
          d < 0 ||
          d > range.maxDays
        ) {
          return false;
        }
      }

      if (
        query.categories?.length &&
        !query.categories.includes(
          e.category,
        )
      ) {
        return false;
      }

      if (query.keyword) {
        const k =
          query.keyword.toLowerCase();

        const hay =
          `${e.title}
          ${e.location}
          ${e.tags.join("")}
          ${e.host.name}`.toLowerCase();

        if (!hay.includes(k)) {
          return false;
        }
      }

      return true;
    })
    .sort(
      (a, b) =>
        +new Date(a.startsAt) -
        +new Date(b.startsAt),
    );
}

/**
 * 获取单个活动。
 */
export async function getActivity(
  id: string,
): Promise<GSEvent | null> {
  const { data, error } =
    await supabase
      .from("activities")
      .select(`
        *,
        activity_categories (
          id,
          name,
          slug
        ),
        profiles (
          id,
          nickname,
          avatar_url
        )
      `)
      .eq("id", id)
      .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }

    throw error;
  }

  return mapActivityToEvent(data);
}

/**
 * 获取当前用户全部活动报名状态。
 *
 * 返回：
 *
 * activity_id -> membership status
 *
 * 不限制 status。
 *
 * 因此：
 *
 * pending
 * approved
 * rejected
 * cancelled
 *
 * 都会保留。
 */
export async function listMembershipStatuses(): Promise<
  Record<string, ActivityMemberStatus>
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {};
  }

  const { data, error } =
    await supabase
      .from("activity_members")
      .select(
        "activity_id, status",
      )
      .eq("user_id", user.id);

  if (error) {
    console.error(
      "获取活动报名状态失败:",
      error,
    );
    throw error;
  }

  const statuses: Record<
    string,
    ActivityMemberStatus
  > = {};

  for (const item of data ?? []) {
    statuses[item.activity_id] =
      item.status as ActivityMemberStatus;
  }

  return statuses;
}

/**
 * 已参加活动 ID。
 *
 * 这是旧页面兼容接口，不是完整 membership 数据源。
 *
 * 业务定义：
 *
 * 1. membership.status = approved
 * 2. 当前用户不是活动 Host
 *
 * Host 虽然会因为数据库 trigger
 * 自动拥有 approved membership，
 * 但不属于“我参加的”。
 */
export async function listJoinedIds(): Promise<
  string[]
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } =
    await supabase
      .from("activity_members")
      .select(`
        activity_id,
        activities (
          host_id
        )
      `)
      .eq("user_id", user.id)
      .eq("status", "approved");

  if (error) {
    console.error(
      "获取已参加活动失败:",
      error,
    );
    throw error;
  }

  return (data ?? [])
    .filter((item) => {
      const activity =
        Array.isArray(item.activities)
          ? item.activities[0]
          : item.activities;

      return (
        !activity ||
        activity.host_id !== user.id
      );
    })
    .map(
      (item) => item.activity_id,
    );
}

/**
 * 加入活动。
 *
 * 新报名：
 *
 * null → pending
 *
 * 重新报名：
 *
 * cancelled → pending
 *
 * rejected 为终态，不允许重新报名。
 *
 * 已通过：
 *
 * approved → 不允许重复报名
 *
 * 待审核：
 *
 * pending → 不允许重复提交
 */
export async function joinActivity(
  id: string,
): Promise<ActivityMutationResult> {
  console.log(
    "🔥 joinActivity called",
    id,
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("请先登录");
  }

  /**
   * 只有 published / confirmed 活动接受报名。
   * 该判断同时覆盖新报名和 cancelled → pending 的重新报名。
   */
  const eventBeforeJoin =
    await getActivity(id);

  if (!eventBeforeJoin) {
    throw new Error(
      "活动不存在或当前无法访问",
    );
  }

  if (
    eventBeforeJoin.status !== "published" &&
    eventBeforeJoin.status !== "confirmed"
  ) {
    throw new Error(
      "当前活动已不接受新的报名",
    );
  }

  /**
   * 查询当前用户已有报名记录。
   */
  const { data: existing, error: existingError } =
    await supabase
      .from("activity_members")
      .select("*")
      .eq("activity_id", id)
      .eq("user_id", user.id)
      .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    if (
      existing.status ===
      "rejected"
    ) {
      throw new Error(
        "你的报名已被组织者拒绝，不能重新报名",
      );
    }

    if (
      existing.status ===
      "approved"
    ) {
      throw new Error(
        "你已经报名成功",
      );
    }

    if (
      existing.status ===
      "pending"
    ) {
      throw new Error(
        "报名申请已提交，请等待发起者审核",
      );
    }

    /**
     * cancelled 可以重新报名。
     * rejected 是终态，前面已经明确拒绝。
     */
    if (
      existing.status ===
      "cancelled"
    ) {
      const { error } =
        await supabase
          .from("activity_members")
          .update({
            status: "pending",
            cancelled_at: null,
          })
          .eq("id", existing.id)
          .eq("user_id", user.id);

      if (error) {
        throw error;
      }
    }
  } else {
    /**
     * 新报名。
     */
    const { error } =
      await supabase
        .from("activity_members")
        .insert({
          activity_id: id,
          user_id: user.id,
          status: "pending",
        });

    if (error) {
      throw error;
    }
  }

  return {
    event,
    membershipStatus: "pending",
  };
}

/**
 * 待审核报名者。
 *
 * 这里只读取指定活动中
 * status = pending 的报名记录。
 *
 * 真正的数据访问权限由 Supabase RLS 控制。
 */
export interface PendingActivityMember {
  id: string;
  activityId: string;
  userId: string;
  status: "pending";
  profile: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
  } | null;
}

export async function getPendingMembers(
  activityId: string,
): Promise<PendingActivityMember[]> {
  const { data, error } =
    await supabase
      .from("activity_members")
      .select(`
        id,
        activity_id,
        user_id,
        status,
        profiles (
          id,
          nickname,
          avatar_url
        )
      `)
      .eq("activity_id", activityId)
      .eq("status", "pending")
      .order("id", {
        ascending: true,
      });

  if (error) {
    throw error;
  }

  return (data ?? []).map(
    (item) => ({
      id: item.id,
      activityId:
        item.activity_id,
      userId:
        item.user_id,
      status: "pending",
      profile: item.profiles
        ? {
            id: item.profiles.id,
            nickname:
              item.profiles.nickname,
            avatarUrl:
              item.profiles.avatar_url,
          }
        : null,
    }),
  );
}

/**
 * 已通过成员。
 *
 * 注意：
 * 数据库中的 Host 也会因为 trigger
 * 拥有 approved membership。
 *
 * 因此这里仍然返回数据库中的全部
 * approved membership。
 *
 * Phase 3 管理页面显示“参加成员”时，
 * 应根据 activity.host_id 排除 Host。
 */
export interface ApprovedActivityMember {
  id: string;
  activityId: string;
  userId: string;
  status: "approved";
  profile: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
  } | null;
}

export async function getApprovedMembers(
  activityId: string,
): Promise<ApprovedActivityMember[]> {
  const { data, error } =
    await supabase
      .from("activity_members")
      .select(`
        id,
        activity_id,
        user_id,
        status,
        profiles (
          id,
          nickname,
          avatar_url
        )
      `)
      .eq("activity_id", activityId)
      .eq("status", "approved")
      .order("id", {
        ascending: true,
      });

  if (error) {
    throw error;
  }

  return (data ?? []).map(
    (item) => ({
      id: item.id,
      activityId:
        item.activity_id,
      userId:
        item.user_id,
      status: "approved",
      profile: item.profiles
        ? {
            id: item.profiles.id,
            nickname:
              item.profiles.nickname,
            avatarUrl:
              item.profiles.avatar_url,
          }
        : null,
    }),
  );
}

/**
 * 审核通过报名。
 *
 * pending → approved
 *
 * 前端不直接 UPDATE。
 * 统一使用数据库函数：
 *
 * approve_activity_member()
 *
 * 数据库负责：
 *
 * 1. 验证组织者 / admin
 * 2. 锁定活动
 * 3. 验证 published
 * 4. 锁定报名记录
 * 5. 验证 pending
 * 6. 检查 participant_limit
 * 7. pending → approved
 *
 * approved 后由 trigger 同步到 chat_members。
 */
export async function approveMember(
  memberId: string,
): Promise<void> {
  const {
    data: membership,
    error: membershipError,
  } = await supabase
    .from("activity_members")
    .select(
      "activity_id, status",
    )
    .eq("id", memberId)
    .maybeSingle();

  if (membershipError) {
    console.error(
      "获取报名记录失败:",
      membershipError,
    );
    throw membershipError;
  }

  if (!membership) {
    throw new Error(
      "报名记录不存在",
    );
  }

  if (
    membership.status !==
    "pending"
  ) {
    throw new Error(
      "当前报名状态不能审核通过",
    );
  }

  const { error } =
    await supabase.rpc(
      "approve_activity_member",
      {
        p_activity_id:
          membership.activity_id,
        p_member_id: memberId,
      },
    );

  if (error) {
    console.error(
      "approve_activity_member RPC error:",
      error,
    );

    throw new Error(
      error.message ||
        "审核报名失败",
    );
  }
}

/**
 * 拒绝报名。
 *
 * pending → rejected
 *
 * 注意：
 *
 * 当前数据库 RLS 对该 UPDATE 的 with-check
 * 仍需要与这个业务状态保持一致。
 *
 * Phase 1 不修改数据库策略。
 */
export async function rejectMember(
  memberId: string,
): Promise<void> {
  const { error } =
    await supabase
      .from("activity_members")
      .update({
        status: "rejected",
      })
      .eq("id", memberId)
      .eq("status", "pending");

  if (error) {
    throw error;
  }
}

/**
 * 确认活动。
 *
 * published → confirmed
 *
 * 确认后由数据库 trigger：
 *
 * open_activity_chat()
 *        ↓
 * approved members
 *        ↓
 * chat_members.active
 */
export async function confirmActivity(
  activityId: string,
): Promise<GSEvent> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("请先登录");
  }

  const { data, error } =
    await supabase
      .from("activities")
      .update({
        status: "confirmed",
      })
      .eq("id", activityId)
      .eq("host_id", user.id)
      .eq("status", "published")
      .select(`
        *,
        activity_categories (
          id,
          name,
          slug
        ),
        profiles (
          id,
          nickname,
          avatar_url
        )
      `)
      .single();

  if (error) {
    throw error;
  }

  return mapActivityToEvent(
    data,
  );
}

/**
 * 活动开始前 2 小时不能取消。
 */
export const CANCEL_LOCK_HOURS = 2;

export function canCancel(
  event: Pick<
    GSEvent,
    "startsAt" | "status"
  >,
  now = Date.now(),
): boolean {
  if (
    event.status === "cancelled" ||
    event.status === "completed"
  ) {
    return false;
  }

  return (
    new Date(
      event.startsAt,
    ).getTime() -
      now >
    CANCEL_LOCK_HOURS *
      3600000
  );
}

/**
 * 组织者取消活动。
 *
 * published / confirmed → cancelled
 *
 * 前端先执行 2 小时规则检查。
 * 数据库 RLS / 状态 transition /
 * close chat trigger 继续提供后端保护。
 *
 * Phase 1 统一返回：
 *
 * {
 *   event,
 *   membershipStatus
 * }
 *
 * 注意：
 * 这里 membershipStatus 指当前登录用户
 * 在该活动中的 membership 状态。
 *
 * 对 Host 而言，数据库中的 Host membership
 * 通常是 approved。
 */
export async function cancelActivity(
  activityId: string,
): Promise<ActivityMutationResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("请先登录");
  }

  /**
   * 先读取当前活动，
   * 执行前端业务规则检查。
   */
  const event =
    await getActivity(activityId);

  if (!event) {
    throw new Error(
      "活动不存在",
    );
  }

  if (event.hostId !== user.id) {
    throw new Error(
      "只有活动组织者可以取消活动",
    );
  }

  if (!canCancel(event)) {
    throw new Error(
      "当前活动已不能取消：活动已结束，或距离开始时间不足2小时",
    );
  }

  const { data, error } =
    await supabase
      .from("activities")
      .update({
        status: "cancelled",
      })
      .eq("id", activityId)
      .eq("host_id", user.id)
      .in("status", [
        "published",
        "confirmed",
      ])
      .select(`
        *,
        activity_categories (
          id,
          name,
          slug
        ),
        profiles (
          id,
          nickname,
          avatar_url
        )
      `)
      .single();

  if (error) {
    throw error;
  }

  return {
    event: mapActivityToEvent(
      data,
    ),
    membershipStatus:
      "approved",
  };
}

/**
 * 参与者退出活动。
 *
 * pending / approved → cancelled
 *
 * rejected 为终态，不能退出或转换为 cancelled。
 *
 * 这里只能取消当前登录用户自己的报名记录。
 */
export async function leaveActivity(
  activityId: string,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("请先登录");
  }

  const {
    data: membership,
    error: membershipError,
  } = await supabase
    .from("activity_members")
    .select("id, status")
    .eq("activity_id", activityId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    throw membershipError;
  }

  if (!membership) {
    throw new Error(
      "你还没有报名这个活动",
    );
  }

  if (
    membership.status !==
      "pending" &&
    membership.status !==
      "approved"
  ) {
    throw new Error(
      "当前报名状态不能退出活动",
    );
  }

  const { error } =
    await supabase
      .from("activity_members")
      .update({
        status: "cancelled",
      })
      .eq("id", membership.id)
      .eq("user_id", user.id)
      .in("status", [
        "pending",
        "approved",
      ]);

  if (error) {
    throw error;
  }
}

/**
 * 创建活动输入。
 */
export interface CreateActivityInput {
  title: string;

  category: CategoryId;

  cover: string;

  startsAt: string;

  endsAt: string;

  location: string;

  district: string;

  limit: number;

  tags: string[];

  fee: number;

  deposit: number;

  agenda: {
    time: string;
    text: string;
  }[];

  eligibility: GSEvent["eligibility"];

  description: string;

  /**
   * 保留这个字段是为了兼容现有页面。
   *
   * 实际 host 身份不使用这个字段，
   * 而是始终使用 auth.uid()。
   */
  host: GSEvent["host"];

  isPrivate?: boolean;

  roomPassword?: string;
}

/**
 * 前端分类 -> 数据库分类 slug。
 */
function getDbCategorySlug(
  category: CategoryId,
): string {
  switch (category) {
    case "run":
    case "badminton":
      return "sports";

    case "coffee":
    case "dinner":
      return "dining";

    case "concert":
    case "women":
      return "hobbies";

    case "boardgame":
      return "games";

    case "hiking":
      return "outdoor";

    default:
      throw new Error(
        `不支持的活动分类：${category}`,
      );
  }
}

/**
 * 创建活动。
 *
 * Host 身份永远来自：
 *
 * auth.uid()
 *
 * 不使用 input.host.id。
 */
export async function createActivity(
  input: CreateActivityInput,
): Promise<GSEvent> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "请先登录",
    );
  }

  const dbCategorySlug =
    getDbCategorySlug(
      input.category,
    );

  const {
    data: categoryRow,
    error: categoryError,
  } = await supabase
    .from("activity_categories")
    .select("id")
    .eq(
      "slug",
      dbCategorySlug,
    )
    .eq("is_active", true)
    .single();

  if (
    categoryError ||
    !categoryRow
  ) {
    throw new Error(
      `找不到活动分类：${dbCategorySlug}`,
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("activities")
    .insert({
      host_id: user.id,

      title: input.title,

      category_id:
        categoryRow.id,

      cover: input.cover,

      starts_at:
        input.startsAt,

      ends_at:
        input.endsAt,

      location:
        input.location,

      district:
        input.district,

      participant_limit:
        input.limit,

      fee: input.fee,

      deposit:
        input.deposit,

      agenda:
        input.agenda as unknown as never,

      eligibility:
        input.eligibility as unknown as never,

      description:
        input.description,

      is_private:
        input.isPrivate ?? false,

      room_password:
        input.roomPassword ??
        null,

      invite_token:
        input.isPrivate
          ? makeInviteToken(
              crypto.randomUUID(),
            )
          : null,

      status:
        "published",
    })
    .select(`
      *,
      activity_categories (
        id,
        name,
        slug
      ),
      profiles (
        id,
        nickname,
        avatar_url
      )
    `)
    .single();

  if (error) {
    throw error;
  }

  return mapActivityToEvent(
    data,
  );
}

/**
 * 判断是否为私密活动。
 */
export function isPrivateEvent(
  event: Pick<
    GSEvent,
    "isPrivate"
  >,
): boolean {
  return (
    event.isPrivate === true
  );
}

/**
 * 验证活动室密码。
 *
 * 注意：
 * 这是前端辅助校验。
 * 真正的数据访问权限仍由 Supabase RLS
 * 和业务状态控制。
 */
export function verifyRoomPassword(
  event: Pick<
    GSEvent,
    "isPrivate" | "roomPassword"
  >,
  input: string,
): boolean {
  if (!event.isPrivate) {
    return true;
  }

  return (
    (event.roomPassword ?? "")
      .trim() === input.trim()
  );
}

/**
 * 创建邀请链接。
 */
export function buildInviteLink(
  event: Pick<
    GSEvent,
    "id" | "inviteToken"
  >,
): string {
  const origin =
    typeof window === "undefined"
      ? ""
      : window.location.origin;

  return `${origin}/event/${event.id}?invite=${encodeURIComponent(
    event.inviteToken ?? "",
  )}`;
}

/**
 * 模板默认值。
 */
export function templateDefaults(
  category: CategoryId,
) {
  return CATEGORY_MAP[category];
}

/**
 * 我的活动。
 *
 * 返回当前用户相关的全部活动：
 *
 * 1. 我发起的活动
 *    activities.host_id = 当前用户
 *
 * 2. 我参加过 / 报名过的活动
 *    activity_members.user_id = 当前用户
 *
 * membership 状态全部保留：
 *
 * pending
 * approved
 * rejected
 * cancelled
 *
 * 同一个活动如果既是 Host 又是 member，
 * 最终只返回一次。
 *
 * 注意：
 * 这里的 joinedIds 是“存在 membership 关系的 ID”，
 * 与 Store 中兼容旧页面使用的 joinedIds
 * 不是同一个语义。
 */
export async function listMyActivities(): Promise<{
  events: GSEvent[];
  hostedIds: string[];
  joinedIds: string[];
  memberStatuses: Record<
    string,
    ActivityMemberStatus
  >;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      events: [],
      hostedIds: [],
      joinedIds: [],
      memberStatuses: {},
    };
  }

  /**
   * 1. 查询我发起的活动。
   */
  const {
    data: hostedData,
    error: hostedError,
  } = await supabase
    .from("activities")
    .select(`
      *,
      activity_categories (
        id,
        name,
        slug
      ),
      profiles (
        id,
        nickname,
        avatar_url
      )
    `)
    .eq("host_id", user.id)
    .order("starts_at", {
      ascending: true,
    });

  if (hostedError) {
    console.error(
      "获取我发起的活动失败:",
      hostedError,
    );
    throw hostedError;
  }

  /**
   * 2. 查询当前用户全部报名关系。
   *
   * 不限制 status。
   */
  const {
    data: memberData,
    error: memberError,
  } = await supabase
    .from("activity_members")
    .select(
      "activity_id, status",
    )
    .eq("user_id", user.id);

  if (memberError) {
    console.error(
      "获取我参加的活动失败:",
      memberError,
    );
    throw memberError;
  }

  /**
   * 3. 建立：
   *
   * activity_id → membership status
   */
  const memberStatuses: Record<
    string,
    ActivityMemberStatus
  > = {};

  for (
    const item of memberData ?? []
  ) {
    memberStatuses[
      item.activity_id
    ] =
      item.status as ActivityMemberStatus;
  }

  /**
   * 这里保留全部 membership ID。
   *
   * my-activities 页面后续通过 hostedIds
   * 区分 Host / Participant。
   */
  const joinedIds =
    (memberData ?? []).map(
      (item) =>
        item.activity_id,
    );

  const hostedIds =
    (hostedData ?? []).map(
      (item) => item.id,
    );

  /**
   * 4. 找出我参加但不是我发起的活动。
   */
  const hostedIdSet =
    new Set(hostedIds);

  const additionalJoinedIds =
    joinedIds.filter(
      (id) =>
        !hostedIdSet.has(id),
    );

  let joinedEvents: GSEvent[] =
    [];

  if (
    additionalJoinedIds.length >
    0
  ) {
    const {
      data: joinedData,
      error: joinedError,
    } = await supabase
      .from("activities")
      .select(`
        *,
        activity_categories (
          id,
          name,
          slug
        ),
        profiles (
          id,
          nickname,
          avatar_url
        )
      `)
      .in(
        "id",
        additionalJoinedIds,
      );

    if (joinedError) {
      console.error(
        "获取参加活动详情失败:",
        joinedError,
      );
      throw joinedError;
    }

    joinedEvents =
      (joinedData ?? []).map(
        (item) =>
          mapActivityToEvent(
            item,
          ),
      );
  }

  /**
   * 5. Host 活动。
   */
  const hostedEvents =
    (hostedData ?? []).map(
      (item) =>
        mapActivityToEvent(
          item,
        ),
    );

  /**
   * 6. completed 活动在结束后保留 7 天。
   * 超过 7 天只从“我的活动”隐藏，不删除数据库数据。
   */
  const myActivityCutoff =
    Date.now() -
    7 * 24 * 60 * 60 * 1000;

  const retainedEvents = [
    ...hostedEvents,
    ...joinedEvents,
  ].filter((event) => {
    if (event.status !== "completed") {
      return true;
    }

    return (
      new Date(event.endsAt).getTime() >=
      myActivityCutoff
    );
  });

  /**
   * 7. 合并并按开始时间排序。
   */
  const events = retainedEvents.sort(
    (a, b) =>
      new Date(
        a.startsAt,
      ).getTime() -
      new Date(
        b.startsAt,
      ).getTime(),
  );

  return {
    events,
    hostedIds,
    joinedIds,
    memberStatuses,
  };
}

