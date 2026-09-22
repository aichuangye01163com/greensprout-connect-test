import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { GSEvent } from "@/data/greensprout";
import * as activities from "@/services/activities";
import * as userService from "@/services/user";
import * as auth from "@/services/auth";
import type { AuthSession } from "@/services/auth";
import type { ActivityMemberStatus } from "@/services/activities";

interface Store {
  events: GSEvent[];

  /**
   * 兼容旧页面：
   * 只表示“当前用户已通过审核，并且不是活动组织者”的活动。
   */
  joinedIds: string[];

  /**
   * 当前用户在每个活动中的完整报名状态。
   *
   * activity_id -> membership status
   *
   * pending   = 待审核
   * approved  = 已通过
   * rejected  = 未通过
   * cancelled = 已取消
   */
  membershipStatuses: Record<
    string,
    ActivityMemberStatus
  >;

  profile: userService.UserProfile | null;
  authEmail: string | null;
  /**
   * Auth 初始化是否已经完成。
   *
   * false = 还不能判断用户是否真的未登录
   * true  = Supabase 已完成 INITIAL_SESSION / Auth 状态同步
   */
  authReady: boolean;
  loading: boolean;

  refresh: () => Promise<void>;

  join: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;

  /**
   * 兼容旧页面：
   * 只有 approved 且不是活动组织者才返回 true。
   */
  isJoined: (id: string) => boolean;

  /**
   * 获取当前用户在指定活动中的报名状态。
   * 没有报名记录时返回 null。
   */
  getMembershipStatus: (
    id: string,
  ) => ActivityMemberStatus | null;

  createEvent: (
    input: activities.CreateActivityInput,
  ) => Promise<GSEvent>;

  saveProfile: (
    patch: Partial<userService.UserProfile>,
  ) => Promise<void>;

  register: (
    input: userService.RegisterInput,
  ) => Promise<void>;

  login: (
    input: userService.LoginInput,
  ) => Promise<void>;

  setAuthSession: (
    session: AuthSession | null,
  ) => void;

  logout: () => void;

  isNewUser: () => boolean;
}

const Ctx = createContext<Store | null>(null);

/**
 * 根据活动列表 + 当前用户 membership 状态，
 * 生成兼容旧页面使用的 joinedIds。
 *
 * 业务规则：
 * 1. membership 必须是 approved
 * 2. 当前用户不能是活动 Host
 *
 * 注意：
 * Host 会因为数据库 trigger 自动拥有
 * approved membership，但 Host 不属于“我参加的”。
 */
function buildJoinedIds(
  currentEvents: GSEvent[],
  currentMembershipStatuses: Record<
    string,
    ActivityMemberStatus
  >,
  currentUserId?: string,
): string[] {
  if (!currentUserId) {
    return [];
  }

  return currentEvents
    .filter((event) => {
      const membershipStatus =
        currentMembershipStatuses[event.id];

      if (membershipStatus !== "approved") {
        return false;
      }

      if (
        event.hostId &&
        event.hostId === currentUserId
      ) {
        return false;
      }

      return true;
    })
    .map((event) => event.id);
}

export function GSProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [events, setEvents] =
    useState<GSEvent[]>([]);

  /**
   * 兼容旧页面使用。
   *
   * 真正的报名状态以 membershipStatuses 为准。
   */
  const [joinedIds, setJoinedIds] =
    useState<string[]>([]);

  /**
   * 当前用户完整 membership 状态。
   *
   * 这是 Phase 1 新建立的核心状态。
   */
  const [
    membershipStatuses,
    setMembershipStatuses,
  ] = useState<
    Record<string, ActivityMemberStatus>
  >({});

  const [profile, setProfile] =
    useState<userService.UserProfile | null>(
      null,
    );

  const [authEmail, setAuthEmail] =
    useState<string | null>(null);

  /**
   * Auth 初始化状态与业务数据 loading 分离。
   *
   * Auth 尚未完成初始化时，页面不能把“未知”当成“未登录”。
   */
  const [authReady, setAuthReady] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  /**
   * Auth Session 这里只负责同步认证邮箱。
   *
   * 完整 Profile 不在这里自行映射。
   * Profile 统一由 userService.getProfile()
   * 获取。
   */
  const applySession = useCallback(
    (session: AuthSession | null) => {
      setAuthReady(true);
      setAuthEmail(
        session?.user.email ?? null,
      );
    },
    [],
  );

  /**
   * 刷新整个 Store。
   *
   * 数据来源：
   *
   * 1. listActivities()
   *    → 活动列表
   *
   * 2. listMembershipStatuses()
   *    → 当前用户完整报名状态
   *
   * 3. auth.getSession()
   *    → 当前登录状态
   *
   * 4. userService.getProfile()
   *    → 完整用户资料
   */
  const refresh = useCallback(async () => {
    try {
      const [
        currentEvents,
        currentMembershipStatuses,
        session,
        currentProfile,
      ] = await Promise.all([
        activities.listActivities(),
        activities.listMembershipStatuses(),
        auth.getSession(),
        userService.getProfile(),
      ]);

      setEvents(currentEvents);

      setMembershipStatuses(
        currentMembershipStatuses,
      );

      setProfile(currentProfile);

      applySession(session);

      const currentUserId =
        session?.user.id ??
        currentProfile?.id;

      setJoinedIds(
        buildJoinedIds(
          currentEvents,
          currentMembershipStatuses,
          currentUserId,
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  useEffect(() => {
    void refresh();

    /**
     * 监听 Supabase Auth 状态。
     *
     * 这里不直接执行异步 Supabase 查询。
     * 完整 Profile / Membership 数据由 refresh()
     * 统一获取。
     */
    const unsub =
      auth.onAuthStateChange(
        (event, session) => {
          applySession(session);

          if (
            event === "PASSWORD_RECOVERY"
          ) {
            window.setTimeout(() => {
              if (
                window.location.pathname !==
                "/reset-password"
              ) {
                window.location.assign(
                  "/reset-password",
                );
              }
            }, 0);
          }
        },
      );

    return unsub;
  }, [
    refresh,
    applySession,
  ]);

  const value = useMemo<Store>(
    () => ({
      events,

      joinedIds,

      membershipStatuses,

      profile,

      authEmail,

      authReady,

      loading,

      refresh,

      /**
       * 报名：
       *
       * 新报名       → pending
       * rejected     → pending
       * cancelled    → pending
       *
       * Service 层负责真正执行数据库操作，
       * Store 只同步 Service 返回的状态。
       */
      join: async (id) => {
        const res =
          await activities.joinActivity(id);

        const nextMembershipStatuses = {
          ...membershipStatuses,
          [id]: res.membershipStatus,
        };

        setMembershipStatuses(
          nextMembershipStatuses,
        );

        if (res.event) {
          setEvents((prevEvents) => {
            const nextEvents =
              prevEvents.map((event) =>
                event.id === id
                  ? res.event
                  : event,
              );

            setJoinedIds(
              buildJoinedIds(
                nextEvents,
                nextMembershipStatuses,
                profile?.id,
              ),
            );

            return nextEvents;
          });
        } else {
          setJoinedIds(
            buildJoinedIds(
              events,
              nextMembershipStatuses,
              profile?.id,
            ),
          );
        }
      },

      /**
       * 取消报名：
       *
       * pending / approved
       *        ↓
       *   cancelled
       *
       * Service 层负责数据库业务规则，
       * Store 只同步返回结果。
       */
      cancel: async (id) => {
        const res =
          await activities.cancelActivity(id);

        const nextMembershipStatuses = {
          ...membershipStatuses,
          [id]: res.membershipStatus,
        };

        setMembershipStatuses(
          nextMembershipStatuses,
        );

        if (res.event) {
          setEvents((prevEvents) => {
            const nextEvents =
              prevEvents.map((event) =>
                event.id === id
                  ? res.event
                  : event,
              );

            setJoinedIds(
              buildJoinedIds(
                nextEvents,
                nextMembershipStatuses,
                profile?.id,
              ),
            );

            return nextEvents;
          });
        } else {
          setJoinedIds(
            buildJoinedIds(
              events,
              nextMembershipStatuses,
              profile?.id,
            ),
          );
        }
      },

      /**
       * 兼容旧页面。
       *
       * 真正的“已参加”定义：
       *
       * membership = approved
       * +
       * 当前用户不是 Host
       */
      isJoined: (id) => {
        if (
          membershipStatuses[id] !==
          "approved"
        ) {
          return false;
        }

        const event =
          events.find(
            (item) => item.id === id,
          );

        if (
          event?.hostId &&
          profile?.id &&
          event.hostId === profile.id
        ) {
          return false;
        }

        return joinedIds.includes(id);
      },

      /**
       * 获取当前用户在指定活动中的完整报名状态。
       */
      getMembershipStatus: (id) =>
        membershipStatuses[id] ?? null,

      /**
       * 创建活动。
       *
       * activities.createActivity()
       * 会使用当前 auth user 作为 host。
       *
       * 数据库 trigger 会自动创建 Host 的
       * approved activity_members 记录。
       *
       * 但 Host 不属于 joinedIds。
       */
      createEvent: async (input) => {
        const created =
          await activities.createActivity(
            input,
          );

        setEvents((prev) => [
          created,
          ...prev,
        ]);

        return created;
      },

      /**
       * Profile 直接使用 userService。
       *
       * Store 不再重复定义 Profile 映射规则。
       */
      saveProfile: async (patch) => {
        const updatedProfile =
          await userService.updateProfile(
            patch,
          );

        setProfile(updatedProfile);
      },

      /**
       * 注册走 Supabase Auth。
       */
      register: async (input) => {
        await userService.registerAccount(
          input,
        );

        await refresh();
      },

      /**
       * 登录走 Supabase Auth。
       */
      login: async (input) => {
        await userService.loginAccount(
          input,
        );

        await refresh();
      },

      /**
       * 外部同步 Auth Session。
       *
       * 完整 Profile / Membership
       * 仍由 refresh() 获取。
       */
      setAuthSession: (session) => {
        applySession(session);
      },

      /**
       * Supabase Auth 负责真正退出登录。
       *
       * 同时清理当前用户相关 Store 状态。
       */
      logout: () => {
        void auth
          .signOut()
          .catch(() => undefined);

        userService.logout();

        setProfile(null);
        setAuthEmail(null);
        setJoinedIds([]);
        setMembershipStatuses({});
        setEvents([]);
      },

      /**
       * Phase 1 暂不重新设计该语义。
       */
      isNewUser: () =>
        profile === null,
    }),
    [
      events,
      joinedIds,
      membershipStatuses,
      profile,
      authEmail,
      authReady,
      loading,
      refresh,
      applySession,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

export function useGS() {
  const ctx = useContext(Ctx);

  if (!ctx) {
    throw new Error(
      "useGS 必须在 GSProvider 内使用",
    );
  }

  return ctx;
}
