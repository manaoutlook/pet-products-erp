import type { Express, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware";
import { idParamSchema, validateBody, validateParams, validateQuery } from "../validate";
import {
  ATTACHMENT_ENTITY_MODULES,
  ATTACHMENT_ENTITY_TYPES,
  MAX_ATTACHMENTS_PER_ENTITY,
  type AttachmentEntityType,
} from "../../shared/attachments";
import { roleCan } from "../../shared/permissions";
import {
  attachImage,
  attachmentErrorBody,
  getAttachment,
  listAttachments,
  removeAttachment,
} from "../attachments";

/**
 * Proof-document endpoints (photos of receipts, bank-transfer screenshots, paperwork).
 *
 * GET    /api/attachments?entityType=&entityId=  - the pictures on one transaction
 * POST   /api/attachments                        - attach ONE picture {entityType, entityId, fileName, dataUrl}
 * DELETE /api/attachments/:id                    - remove a picture (row + file)
 *
 * AI Agent Note - one picture per request on purpose. A phone photo is a few MB and
 * `express.json` is capped at 10 MB, so five phone photos in one body would be rejected before
 * this code runs; the client uploads them one after another instead (attachment-api.ts).
 *
 * Access follows the transaction: purchase orders and goods receipts are gated by
 * `purchaseOrders`, customer receipts by `receipts`, finance entries by `finance` (see
 * shared/attachments.ts). Reading needs `read`, adding or removing a picture needs `update` -
 * removing a wrong photo edits the transaction's evidence, it does not delete the transaction.
 */

const listQuerySchema = z.object({
  entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
  entityId: z.coerce.number().int().positive("A valid transaction id is required"),
});

const attachBodySchema = z.object({
  entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
  entityId: z.coerce.number().int().positive("A valid transaction id is required"),
  fileName: z.string().trim().min(1, "The picture needs a file name").max(255),
  dataUrl: z.string().min(1, "Choose a picture to attach"),
});

/** Does this user hold the transaction's permission for `action`? */
function canTouchEntity(
  user: { role?: unknown } | undefined,
  entityType: AttachmentEntityType,
  action: "read" | "update"
): boolean {
  const module = ATTACHMENT_ENTITY_MODULES[entityType];
  return roleCan(user?.role as Parameters<typeof roleCan>[0], module, action);
}

function respondWithError(res: Response, error: unknown, fallback: string) {
  const { status, body } = attachmentErrorBody(error, fallback);
  return res.status(status).json(body);
}

export function registerAttachmentRoutes(app: Express) {
  app.get(
    "/api/attachments",
    requireAuth,
    validateQuery(listQuerySchema, "Choose the transaction whose pictures you want"),
    async (req, res) => {
      const { entityType, entityId } = req.query as unknown as z.infer<typeof listQuerySchema>;

      if (!canTouchEntity(req.user, entityType, "read")) {
        return res.status(403).json({
          message: "You cannot see the documents of this transaction",
          suggestion: "Ask an administrator for access to this module",
        });
      }

      try {
        const attachments = await listAttachments(entityType, entityId);
        return res.json({ attachments, limit: MAX_ATTACHMENTS_PER_ENTITY });
      } catch (error) {
        return respondWithError(res, error, "Failed to load the pictures");
      }
    }
  );

  app.post(
    "/api/attachments",
    requireAuth,
    validateBody(attachBodySchema, "Check the picture and the transaction it belongs to"),
    async (req, res) => {
      const { entityType, entityId, fileName, dataUrl } =
        req.body as z.infer<typeof attachBodySchema>;

      if (!canTouchEntity(req.user, entityType, "update")) {
        return res.status(403).json({
          message: "You cannot attach pictures to this transaction",
          suggestion: "Ask an administrator for update access to this module",
        });
      }

      try {
        const attachment = await attachImage(
          entityType,
          entityId,
          { fileName, dataUrl },
          req.user?.id ?? null
        );
        return res.status(201).json({ attachment });
      } catch (error) {
        return respondWithError(res, error, "Failed to save the picture");
      }
    }
  );

  app.delete(
    "/api/attachments/:id",
    requireAuth,
    validateParams(idParamSchema, "Use a numeric picture id"),
    async (req, res) => {
      const { id } = req.params as unknown as z.infer<typeof idParamSchema>;

      try {
        const attachment = await getAttachment(id);

        if (!attachment) {
          return res.status(404).json({
            message: "Picture not found",
            suggestion: "Reload the transaction",
          });
        }

        if (!canTouchEntity(req.user, attachment.entityType, "update")) {
          return res.status(403).json({
            message: "You cannot remove pictures from this transaction",
            suggestion: "Ask an administrator for update access to this module",
          });
        }

        await removeAttachment(id);
        return res.status(204).send();
      } catch (error) {
        return respondWithError(res, error, "Failed to remove the picture");
      }
    }
  );
}
