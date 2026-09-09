import type { MockAdminClient, Pkg, RealService } from "./mock-admin-client";
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

  function openNewRealService() {
    forms.realServiceEditId.value = null;
    forms.realServiceName.value = "";
    forms.targetUrl.value = "";
  }

  function openRealServices() {
    if (!model.pkg.value) return;
    openNewRealService();
    forms.showRealServices.value = true;
  }

  function openRealServiceEdit(service: RealService) {
    forms.realServiceEditId.value = service.id;
    forms.realServiceName.value = service.name;
    forms.targetUrl.value = service.baseUrl;
    forms.showRealServices.value = true;
  }

  async function selectRealService(id: string) {
    const current = model.pkg.value;
    if (!current || !id || current.activeRealServiceId === id) return;
    try {
      const result = await model.runAdminRequest(() => client.activateRealService(current.id, id));
      current.activeRealServiceId = result.activeRealServiceId;
      notify("真实服务已切换");
    } catch (error) { notify(message(error)); }
  }

  async function saveRealService() {
    const current = model.pkg.value;
    if (!current || !forms.realServiceName.value.trim()) return;
    const name = forms.realServiceName.value.trim();
    const baseUrl = forms.targetUrl.value.trim();
    try {
      if (forms.realServiceEditId.value) {
        const saved = await model.runAdminRequest(() => client.updateRealService(forms.realServiceEditId.value!, { name, baseUrl }));
        const service = current.realServices.find((item) => item.id === saved.id);
        if (service) Object.assign(service, saved);
        notify("真实服务已更新");
      } else {
        const created = await model.runAdminRequest(() => client.createRealService(current.id, { name, baseUrl }));
        current.realServices.push(created);
        if (!current.activeRealServiceId) current.activeRealServiceId = created.id;
        notify("真实服务已添加");
        openNewRealService();
      }
    } catch (error) { notify(message(error)); }
  }

  async function deleteRealService(service: RealService) {
    const current = model.pkg.value;
    if (!current || !window.confirm(`确定删除真实服务“${service.name}”吗？`)) return;
    try {
      const result = await model.runAdminRequest(() => client.deleteRealService(service.id));
      const index = current.realServices.findIndex((item) => item.id === service.id);
      if (index >= 0) current.realServices.splice(index, 1);
      current.activeRealServiceId = result.activeRealServiceId;
      if (forms.realServiceEditId.value === service.id) openNewRealService();
      notify("真实服务已删除");
    } catch (error) { notify(message(error)); }
  }

  return {
    switchPackage, openPackage, savePackage, deletePackage,
    openNewRealService, openRealServices, openRealServiceEdit, selectRealService,
    saveRealService, deleteRealService,
  };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
