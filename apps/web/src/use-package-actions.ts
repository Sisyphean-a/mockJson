import type { MockAdminClient, Pkg } from "./mock-admin-client";
import type { useConsoleForms } from "./use-console-forms";
import type { useMockState } from "./use-mock-state";

type Forms = ReturnType<typeof useConsoleForms>;
type Model = ReturnType<typeof useMockState>;
type Notify = (message: string) => void;

export function usePackageActions(client: MockAdminClient, model: Model, forms: Forms, notify: Notify, canLeave: () => boolean) {
  async function switchPackage(id: string) {
    if (!canLeave()) return;
    try { await model.runAdminRequest(() => client.switchPackage(id)); await model.load(); notify("测试包已切换"); }
    catch (error) { notify(message(error)); }
  }

  function openPackage(packageConfig?: Pkg) {
    forms.editingPackageId.value = packageConfig?.id || null;
    forms.packageName.value = packageConfig?.name || "";
    forms.showPackage.value = true;
  }

  async function savePackage() {
    try {
      if (forms.editingPackageId.value) {
        await model.runAdminRequest(() => client.updatePackage(forms.editingPackageId.value!, { name: forms.packageName.value }));
      } else {
        const created = await model.runAdminRequest(() => client.createPackage({ name: forms.packageName.value }));
        await model.runAdminRequest(() => client.switchPackage(created.id));
      }
      forms.showPackage.value = false;
      await model.load();
      notify(forms.editingPackageId.value ? "Package 已更新" : "Package 已创建");
    } catch (error) { notify(message(error)); }
  }

  async function deletePackage(packageConfig: Pkg) {
    if (!window.confirm(`确定删除 Package“${packageConfig.name}”及其全部配置吗？删除后不可恢复。`)) return;
    try { await model.runAdminRequest(() => client.deletePackage(packageConfig.id)); await model.load(); notify("Package 已删除"); }
    catch (error) { notify(message(error)); }
  }

  async function saveTargetUrl() {
    const current = model.pkg.value;
    if (!current) return;
    try {
      const value = forms.targetUrl.value.trim();
      await model.runAdminRequest(() => client.updatePackage(current.id, { targetBaseUrl: value }));
      current.targetBaseUrl = value;
      notify(value ? "真实服务地址已保存" : "已清空真实服务地址");
    } catch (error) { notify(message(error)); }
  }

  return { switchPackage, openPackage, savePackage, deletePackage, saveTargetUrl };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
