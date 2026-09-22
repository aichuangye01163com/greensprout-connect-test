import { supabase } from "@/integrations/supabase/client";

export const DISSOLVE_HOURS_AFTER_END = 12;

export interface ChatMessage {
  name: string;
  avatar: string;
  text: string;
  time: string;
}

export interface ChatRoom {
  eventId: string;
  unlocked: boolean;
  dissolvesAt: string | null;
  messages: ChatMessage[];
}

/**
 * 获取活动群聊
 *
 * 当前业务规则：
 * 1. 活动必须 confirmed 才正式开放群聊
 * 2. 当前用户必须是 chat_members.active 成员
 * 3. 活动结束后 12 小时群聊失效
 * 4. 消息来自 chat_messages
 * 5. 用户昵称和头像来自 profiles
 */
export async function getChatRoom(eventId: string): Promise<ChatRoom> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    return {
      eventId,
      unlocked: false,
      dissolvesAt: null,
      messages: [],
    };
  }

  // 1. 获取活动状态和结束时间
  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select("id, status, ends_at")
    .eq("id", eventId)
    .maybeSingle();

  if (activityError) {
    throw activityError;
  }

  if (!activity) {
    return {
      eventId,
      unlocked: false,
      dissolvesAt: null,
      messages: [],
    };
  }

  // 2. 计算群聊解散时间：活动结束后 12 小时
  const dissolvesAt = activity.ends_at
    ? new Date(
        new Date(activity.ends_at).getTime() +
          DISSOLVE_HOURS_AFTER_END * 60 * 60 * 1000,
      ).toISOString()
    : null;

  // 3. 当前用户是否是 active 群成员
  const { data: membership, error: membershipError } = await supabase
    .from("chat_members")
    .select("status")
    .eq("activity_id", eventId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) {
    throw membershipError;
  }

  const now = Date.now();

  const withinChatTime =
    !activity.ends_at ||
    now <=
      new Date(activity.ends_at).getTime() +
        DISSOLVE_HOURS_AFTER_END * 60 * 60 * 1000;

  const unlocked =
    activity.status === "confirmed" &&
    membership?.status === "active" &&
    withinChatTime;

  // 4. 群聊没有开放时，不读取消息
  if (!unlocked) {
    return {
      eventId,
      unlocked: false,
      dissolvesAt,
      messages: [],
    };
  }

  // 5. 读取聊天消息
  const { data: messages, error: messagesError } = await supabase
    .from("chat_messages")
    .select("id, user_id, content, created_at")
    .eq("activity_id", eventId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (messagesError) {
    throw messagesError;
  }

  const messageRows = messages ?? [];

  // 6. 获取消息对应用户的 profile
  const userIds = [
    ...new Set(messageRows.map((message) => message.user_id)),
  ];

  const profilesById = new Map<
    string,
    {
      nickname: string | null;
      avatar_url: string | null;
    }
  >();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, nickname, avatar_url")
      .in("id", userIds);

    if (profilesError) {
      throw profilesError;
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        nickname: profile.nickname,
        avatar_url: profile.avatar_url,
      });
    }
  }

  // 7. 转换成现有前端 ChatMessage 格式
  const chatMessages: ChatMessage[] = messageRows.map((message) => {
    const profile = profilesById.get(message.user_id);

    return {
      name: profile?.nickname || "GreenSprout 用户",
      avatar: profile?.avatar_url || "",
      text: message.content,
      time: new Date(message.created_at).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  });

  return {
    eventId,
    unlocked: true,
    dissolvesAt,
    messages: chatMessages,
  };
}

/**
 * 发送群聊消息
 *
 * 前端不直接操作 chat_members。
 * 是否有权发消息由 Supabase RLS 决定：
 * - 当前用户必须是 active chat member
 * - 活动必须 confirmed
 * - 未超过活动结束后的 12 小时
 */
export async function sendMessage(
  eventId: string,
  text: string,
): Promise<ChatMessage> {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error("消息不能为空");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user) {
    throw new Error("请先登录");
  }

  // 1. 插入消息
  const { data: message, error: messageError } = await supabase
    .from("chat_messages")
    .insert({
      activity_id: eventId,
      user_id: user.id,
      content: trimmedText,
      status: "active",
    })
    .select("id, user_id, content, created_at")
    .single();

  if (messageError) {
    throw messageError;
  }

  // 2. 获取当前用户 profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("nickname, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  // 3. 返回现有前端需要的 ChatMessage 格式
  return {
    name: profile?.nickname || "GreenSprout 用户",
    avatar: profile?.avatar_url || "",
    text: message.content,
    time: new Date(message.created_at).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}
