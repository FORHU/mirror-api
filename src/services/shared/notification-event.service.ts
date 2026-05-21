export class NotificationService {
  /**
   * Send a notification to a specific user.
   * Returns a promise resolving to a simple confirmation object.
   */
  static async notificationEvent(userId: string, data: any): Promise<{ message: string; userId: string; data: any }> {
    // placeholder implementation – integrate with real notification service later
    return {
      message: "notification sent",
      userId,
      data,
    };
  }

  /**
   * Notify a specific kiosk via Socket.IO.
   * Emits a `kiosk_notification` event to the kiosk's room.
   */
  static async notifyKiosk(kioskId: string, data: any): Promise<{ message: string }> {
    try {
      // `io` is a global Socket.IO server instance initialized in utils/socket.util.ts
      // Import lazily to avoid circular dependencies at load time.
      const { io } = await import("../../utils/socket.util");
      if (io) {
        io.to(kioskId).emit("kiosk_notification", data);
      }
    } catch (err) {
      // Log but do not fail the operation; placeholder logger could be used.
      console.error("Failed to emit kiosk_notification", err);
    }
    return { message: "kiosk notification sent" };
  }
}
