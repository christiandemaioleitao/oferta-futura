-- Executar no projeto Neon SG - Segurança, pelo administrador do SG.
-- Substituir pessoa@ebm.com.br pelo e-mail que deve receber acesso.
-- Não cria tabelas nem altera o banco de dados do dashboard.
INSERT INTO sg.acessos (email, aplicacao, ativo)
VALUES ('pessoa@ebm.com.br', 'oferta_futura', TRUE)
ON CONFLICT (LOWER(TRIM(email)), aplicacao)
DO UPDATE SET ativo = TRUE, atualizado_em = NOW();

-- Para bloquear, o administrador executa:
-- UPDATE sg.acessos SET ativo = FALSE, atualizado_em = NOW()
-- WHERE lower(trim(email)) = 'pessoa@ebm.com.br' AND aplicacao = 'oferta_futura';
