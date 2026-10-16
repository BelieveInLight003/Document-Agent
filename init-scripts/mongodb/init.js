db = db.getSiblingDB('knowledge_hub');

db.createUser({
  user: 'knowledge_hub_user',
  pwd: 'knowledge_hub_password',
  roles: [{ role: 'readWrite', db: 'knowledge_hub' }],
});

// 文档内容：contentId 为雪花 ID
db.createCollection('document_content');
db.document_content.createIndex({ contentId: 1 }, { unique: true });
db.document_content.createIndex({ deleted: 1 });
