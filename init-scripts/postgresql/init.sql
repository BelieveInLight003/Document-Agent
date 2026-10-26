-- 文档元数据表
CREATE TABLE IF NOT EXISTS kh_document (
    id BIGINT PRIMARY KEY,
    title VARCHAR NOT NULL,
    content_id VARCHAR NOT NULL UNIQUE,
    summary VARCHAR,
    category_id BIGINT,
    team_id BIGINT,
    author_id BIGINT,
    cover_image VARCHAR,
    tags VARCHAR,
    status SMALLINT NOT NULL DEFAULT 0, -- 0 草稿，1 已发布，2 归档，3 待审核
    remark VARCHAR,
    view_count INT NOT NULL DEFAULT 0,
    like_count INT NOT NULL DEFAULT 0,
    comment_count INT NOT NULL DEFAULT 0,
    favourite_count INT NOT NULL DEFAULT 0,
    word_count INT NOT NULL DEFAULT 0,
    publish_time TIMESTAMP,
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    create_by BIGINT,
    update_by BIGINT,
    deleted BOOLEAN NOT NULL DEFAULT false
);

-- 文档审核表。review_status：0 待审核，1 通过，2 驳回
CREATE TABLE IF NOT EXISTS kh_document_review (
    id BIGINT PRIMARY KEY,
    document_id BIGINT NOT NULL,
    reviewer_id BIGINT,
    submitter_id BIGINT,
    status_before SMALLINT NOT NULL,
    status_after SMALLINT,
    review_status SMALLINT NOT NULL DEFAULT 0,
    opinion VARCHAR,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kh_document_review_document_id
    ON kh_document_review (document_id);

CREATE UNIQUE INDEX IF NOT EXISTS uk_kh_document_review_pending
    ON kh_document_review (document_id)
    WHERE review_status = 0;
