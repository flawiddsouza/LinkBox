CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
$$;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL,
    username text NOT NULL UNIQUE,
    password text NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (id)
);

DROP TRIGGER IF EXISTS users_updated_at_modtime ON users;
CREATE TRIGGER users_updated_at_modtime BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TABLE IF NOT EXISTS link_groups (
    id SERIAL,
    title TEXT,
    user_id SERIAL NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS link_groups_updated_at_modtime ON link_groups;
CREATE TRIGGER link_groups_updated_at_modtime BEFORE UPDATE ON link_groups FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TABLE IF NOT EXISTS links (
    id SERIAL,
    title TEXT,
    link TEXT NOT NULL,
    link_group_id SERIAL NOT NULL,
    user_id SERIAL NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (id),
    FOREIGN KEY (link_group_id) REFERENCES link_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS links_updated_at_modtime ON links;
CREATE TRIGGER links_updated_at_modtime BEFORE UPDATE ON links FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL,
    api_key TEXT,
    user_id SERIAL NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE api_keys
ADD CONSTRAINT api_key_unique UNIQUE (api_key);