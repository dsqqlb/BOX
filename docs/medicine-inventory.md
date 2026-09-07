# 家庭药箱

路径：`/tools/medicine-inventory`。这是一个供被授予 `medicine-inventory` 权限的家庭账户共同使用的药品库存页；它不是医疗建议或处方替代品。

## 功能

- 药品档案：名称、通用名、品牌、类别、剂型、规格、厂家、产地、批准文号、用途、注意事项和家庭备注。
- 批次库存：生产日期、有效期、批号、初始/剩余数量、单位、入库日期与存放位置；同一种药可有多个批次。
- 提醒：首页统计 30 天内到期、已过期和低库存（单批次余量不超过 5 或药品总库存为零）。到期提示始终依据还有余量的最早批次。
- 用药流水：从具体批次扣减库存并记录数量、时间、服用人、用途、备注和操作账户。扣减与流水插入在同一 SQLite 事务中完成，库存不足不会创建记录。
- 照片：支持 JPEG、PNG、GIF、WebP、AVIF，单张默认最大 10 MiB（`MEDICINE_MAX_UPLOAD_BYTES` 可调，范围 256 KiB–50 MiB）。

## 数据与权限

元数据存入 SQLite 的 `MedicineProduct`、`MedicineBatch`、`MedicineUseLog`、`MedicinePhoto` 表。图片本体写入服务器私有目录 `data/medicine/uploads/`，数据库只保存 UUID 文件名与元数据；该目录已被 Git 忽略，不能作为静态目录或公开文件服务暴露。

图片只能经 `/api/medicine/photos/:id` 读取。该路径与全部 `/api/medicine/*` API 均先验证登录和 `medicine-inventory` 工具权限；所有新增、修改、删除、上传、用药请求还要求同源请求。不要把照片目录映射给 Nginx 或 CDN 公网路径。

药箱数据在获授权账户之间共享。药品创建者和每一笔用药操作人会保留在 SQLite 关联中；任何已授权家庭成员都可维护共享档案。删除已有用药流水的批次会被拒绝，防止审计记录失去批次上下文；删除药品会连同批次、流水、照片元数据和私有图片一起删除。

## 升级与备份

部署更新前运行：

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
```

定期在同一时间点备份 `data/box.sqlite` 与 `data/medicine/`，两者必须一起恢复。图片不在 Git 中，也不会包含于只有数据库文件的备份。
