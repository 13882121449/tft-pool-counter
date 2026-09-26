/**
 * 模板素材域 IPC（架构 §8.3 / PRD Q6）。
 *
 * 版权合规（用户已拍板）：**不内置任何图鉴站素材**，
 * 全部模板由「采集向导」在本地从用户自己的截图切出。
 */

import { ipcMain } from 'electron';
import { readdir } from 'node:fs/promises';
import type { Cost } from '../../shared/types/domain';
import type {
  TemplateAppendRequest,
  TemplateAppendResult,
  TemplateCaptureRequest,
  TemplateCaptureResult,
  TemplateExportRequest,
  TemplateExportResult,
  TemplateImportRequest,
  TemplateImportResult,
  TemplateListPayload,
} from '../../shared/types/ipc';
import type { WizardDraftPayload } from '../../shared/types/vision';
import {
  CH_TEMPLATE_APPEND,
  CH_TEMPLATE_CAPTURE,
  CH_TEMPLATE_EXPORT,
  CH_TEMPLATE_IMPORT,
  CH_TEMPLATE_LIST,
} from '../../shared/ipc/channels';
import {
  buildChampionIndex,
  commitWizard,
  type WizardSlotDraft,
} from '../../vision/templates/capture-wizard';
import { exportTemplateSet, importTemplateSet } from '../../vision/templates/exporter';
import { createFileTemplateStore } from '../../vision/match/template-store';
import { createRawImage, type RawImage } from '../../vision/preprocess/raw-image';
import { bundledTemplatesDir, userTemplatesDir } from '../store/paths';
import type { AppServices } from './context';
import { wrap } from './wrap';

/** 统计目录下的模板文件数（单文件损坏不影响计数）。 */
async function countTemplateFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir);
    return entries.filter(
      (name) =>
        name.toLowerCase().endsWith('.json') &&
        // 目录内的模板集索引与（zip 专用的）清单都不是模板文件，必须排除
        name !== 'index.json' &&
        name !== 'manifest.json',
    ).length;
  } catch {
    return 0;
  }
}

/** 从基线取弈子元信息（id + cost）。 */
function championMeta(services: AppServices): Array<{ id: string; cost: Cost }> {
  const baseline = services.runtime.getBaseline();
  return (baseline?.champions ?? []).map((champion) => ({
    id: champion.id,
    cost: champion.cost,
  }));
}

/** 把未知载荷转成字节（容忍 Buffer / Uint8Array / ArrayBuffer / 数字数组）。 */
function toBytes(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(payload as number[]);
  }
  if (payload !== null && typeof payload === 'object' && 'bytes' in payload) {
    return toBytes((payload as { bytes: unknown }).bytes);
  }
  return new Uint8Array(0);
}

/** 草稿载荷 → 向导草稿（原始 RGBA，无需解码依赖）。 */
function decodeDraft(payload: WizardDraftPayload): WizardSlotDraft {
  if (payload.encoding !== 'raw') {
    throw new Error('不支持的草稿编码（仅支持 raw RGBA）');
  }
  const bytes = toBytes(payload.bytes);
  const expected = payload.width * payload.height * 4;
  if (bytes.length !== expected) {
    throw new Error(`草稿字节数 ${bytes.length} 与宽高不匹配（期望 ${expected}）`);
  }
  const image: RawImage = createRawImage({
    width: payload.width,
    height: payload.height,
    data: bytes,
    channels: 4,
    format: 'rgba',
    source: 'wizard-draft',
  });
  return {
    zone: payload.zone as WizardSlotDraft['zone'],
    slotIndex: payload.slotIndex,
    row: payload.row,
    col: payload.col,
    blank: payload.blank,
    fingerprint: payload.fingerprint,
    image,
  };
}

/**
 * 注册模板素材域 handler。
 *
 * @param services 服务集合。
 */
export function registerTemplateHandlers(services: AppServices): void {
  ipcMain.handle(CH_TEMPLATE_LIST, () =>
    wrap<TemplateListPayload>(async () => ({
      bundled: { dir: bundledTemplatesDir(), count: await countTemplateFiles(bundledTemplatesDir()) },
      user: { dir: userTemplatesDir(), count: await countTemplateFiles(userTemplatesDir()) },
      championCount: championMeta(services).length,
    })),
  );

  ipcMain.handle(CH_TEMPLATE_CAPTURE, (_event, _payload?: TemplateCaptureRequest) =>
    wrap<TemplateCaptureResult>(async () => {
      const capture = await services.vision.captureTemplate();
      return {
        drafts: capture.drafts,
        size: capture.size,
        errors: capture.errors.map((error) => error.message),
      };
    }),
  );

  ipcMain.handle(CH_TEMPLATE_APPEND, (_event, payload: TemplateAppendRequest) =>
    wrap<TemplateAppendResult>(async () => {
      const champions = championMeta(services);
      if (champions.length === 0) {
        throw new Error('卡池基线尚未加载，无法校验模板');
      }
      const dir = userTemplatesDir();
      const store = await createFileTemplateStore(dir, champions);
      const index = buildChampionIndex(champions);
      const drafts = payload.drafts.map((draft) => decodeDraft(draft));
      const result = await commitWizard(store, payload.assignments, drafts, index, dir);
      // 模板库变更 → 重启 worker 强制重新加载
      services.vision.restart();
      return result;
    }),
  );

  ipcMain.handle(CH_TEMPLATE_EXPORT, (_event, payload: TemplateExportRequest) =>
    wrap<TemplateExportResult>(async () => {
      const champions = championMeta(services);
      const store = await createFileTemplateStore(userTemplatesDir(), champions);
      const info = services.runtime.getBaselineInfo();
      return exportTemplateSet(store, payload.outPath, {
        setNumber: info?.setNumber ?? 18,
        patch: info?.patch ?? 'unknown',
      });
    }),
  );

  ipcMain.handle(CH_TEMPLATE_IMPORT, (_event, payload: TemplateImportRequest) =>
    wrap<TemplateImportResult>(async () => {
      const champions = championMeta(services);
      const dir = userTemplatesDir();
      const store = await createFileTemplateStore(dir, champions);
      const result = await importTemplateSet(payload.zipPath, dir, champions, store);
      services.vision.restart();
      return {
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
        dir: result.dir,
        ...(result.manifest !== undefined ? { manifest: result.manifest } : {}),
      };
    }),
  );
}
