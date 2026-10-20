import { Server as SocketIOServer, Socket } from 'socket.io';
import { prisma } from '../lib/prisma';

let ioInstance: SocketIOServer | null = null;

// Track active viewers per sheet: sheetId -> Map of socketId -> user info
const activeViewers = new Map<string, Map<string, { name: string; role: string; lastSeen: number }>>();

// Cache sheet status to avoid DB query overhead on every keystroke
const sheetStatusCache = new Map<string, string>();

async function getSheetStatus(sheetId: string): Promise<string> {
  let status = sheetStatusCache.get(sheetId);
  if (!status) {
    try {
      const s = await prisma.smartSheet.findUnique({ where: { id: sheetId }, select: { status: true } });
      status = s?.status || 'ACTIVE';
      sheetStatusCache.set(sheetId, status);
    } catch (e) {
      status = 'ACTIVE';
    }
  }
  return status;
}

export function updateSheetSocketStatus(sheetId: string, status: string) {
  sheetStatusCache.set(sheetId, status);
  if (ioInstance) {
    ioInstance.to('sheet_' + sheetId).emit('sheet:status-changed', {
      sheetId,
      status,
      isClosed: status === 'CLOSED'
    });
  }
}

export function initSmartSheetSocket(io: SocketIOServer) {
  ioInstance = io;

  io.on('connection', (socket: Socket) => {
    let currentSheetId: string | null = null;

    // 1. Join Sheet Room
    socket.on('sheet:join', (payload: { sheetId: string; user?: { name?: string; role?: string } }) => {
      if (!payload || !payload.sheetId) return;
      const sheetId = String(payload.sheetId);
      currentSheetId = sheetId;
      const roomName = 'sheet_' + sheetId;

      socket.join(roomName);

      if (!activeViewers.has(sheetId)) {
        activeViewers.set(sheetId, new Map());
      }
      const roomMap = activeViewers.get(sheetId)!;
      roomMap.set(socket.id, {
        name: payload.user?.name || 'Pengunjung',
        role: payload.user?.role || 'PUBLIC',
        lastSeen: Date.now()
      });

      // Broadcast updated online count to the room
      io.to(roomName).emit('sheet:presence', {
        count: roomMap.size,
        users: Array.from(roomMap.values()).map(u => ({ name: u.name, role: u.role }))
      });
    });

    // 2. Realtime Single Cell Update
    socket.on('sheet:cell-update', async (payload: {
      sheetId: string;
      rowId: string;
      colId: string;
      value: any;
      updatedBy?: string;
    }) => {
      if (!payload || !payload.sheetId || !payload.rowId || !payload.colId) return;
      const { sheetId, rowId, colId, value, updatedBy } = payload;
      const roomName = 'sheet_' + sheetId;

      // Cek status apakah spreadsheet sedang DITUTUP (CLOSED)
      const status = await getSheetStatus(sheetId);
      if (status === 'CLOSED') {
        socket.emit('sheet:error', { message: 'Spreadsheet ini telah DITUTUP oleh admin.' });
        return;
      }

      // Broadcast instantly to all other clients in this sheet room
      socket.to(roomName).emit('sheet:cell-updated', {
        rowId,
        colId,
        value,
        updatedBy: updatedBy || 'Pengunjung',
        socketId: socket.id
      });

      // Persist to database in background via atomic PostgreSQL JSONB merge
      try {
        const jsonDelta = JSON.stringify({ [colId]: value });
        await prisma.$executeRaw`
          UPDATE "SmartSheetRow"
          SET "data" = "data"::jsonb || ${jsonDelta}::jsonb,
              "lastUpdatedAt" = NOW(),
              "lastUpdatedBy" = ${updatedBy || 'Publik'}
          WHERE "id" = ${rowId}
        `;
      } catch (err) {
        console.error(`[WebSocket] Error updating cell ${rowId}:${colId}:`, err);
      }
    });

    // 3. Realtime Rows Sync (Sort / Bulk Edit / Bulk Clear / Delete Rows)
    socket.on('sheet:sync-rows', async (payload: {
      sheetId: string;
      rows: any[];
      updatedBy?: string;
    }) => {
      if (!payload || !payload.sheetId || !Array.isArray(payload.rows)) return;
      const { sheetId, rows, updatedBy } = payload;
      const roomName = 'sheet_' + sheetId;

      const status = await getSheetStatus(sheetId);
      if (status === 'CLOSED') {
        socket.emit('sheet:error', { message: 'Spreadsheet ini telah DITUTUP oleh admin.' });
        return;
      }

      socket.to(roomName).emit('sheet:rows-synced', {
        rows,
        updatedBy: updatedBy || 'Admin',
        socketId: socket.id
      });
    });

    // 3b. Realtime Columns Sync (Validation / Add Column / Delete Column / Colors)
    socket.on('sheet:sync-columns', async (payload: {
      sheetId: string;
      columns: any[];
      updatedBy?: string;
    }) => {
      if (!payload || !payload.sheetId || !Array.isArray(payload.columns)) return;
      const { sheetId, columns, updatedBy } = payload;
      const roomName = 'sheet_' + sheetId;

      const status = await getSheetStatus(sheetId);
      if (status === 'CLOSED') {
        socket.emit('sheet:error', { message: 'Spreadsheet ini telah DITUTUP oleh admin.' });
        return;
      }

      socket.to(roomName).emit('sheet:columns-synced', {
        columns,
        updatedBy: updatedBy || 'Admin',
        socketId: socket.id
      });
    });

    // 4. Leave / Disconnect
    const handleLeave = () => {
      if (currentSheetId && activeViewers.has(currentSheetId)) {
        const roomMap = activeViewers.get(currentSheetId)!;
        roomMap.delete(socket.id);
        const roomName = 'sheet_' + currentSheetId;
        if (roomMap.size === 0) {
          activeViewers.delete(currentSheetId);
        } else {
          io.to(roomName).emit('sheet:presence', {
            count: roomMap.size,
            users: Array.from(roomMap.values()).map(u => ({ name: u.name, role: u.role }))
          });
        }
      }
    };

    socket.on('sheet:leave', handleLeave);
    socket.on('disconnect', handleLeave);
  });
}

// Helper to broadcast from HTTP controllers (e.g. file upload or HTTP save)
export function broadcastSheetCellUpdate(sheetId: string, rowId: string, colId: string, value: any, updatedBy?: string) {
  if (!ioInstance || !sheetId) return;
  ioInstance.to('sheet_' + sheetId).emit('sheet:cell-updated', {
    rowId,
    colId,
    value,
    updatedBy: updatedBy || 'System'
  });
}

export function broadcastSheetRowsSync(sheetId: string, rows: any[], updatedBy?: string) {
  if (!ioInstance || !sheetId) return;
  ioInstance.to('sheet_' + sheetId).emit('sheet:rows-synced', {
    rows,
    updatedBy: updatedBy || 'System'
  });
}
