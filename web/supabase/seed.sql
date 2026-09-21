-- Starter vocabulary (glosses in Portuguese). Safe to run more than once:
-- words that already exist are skipped. Positions 1-17 are the original list.
insert into public.vocabulary (word, position) values
  ('olá', 1), ('obrigado', 2), ('por favor', 3), ('sim', 4), ('não', 5),
  ('água', 6), ('comida', 7), ('ajuda', 8), ('casa', 9), ('bom dia', 10),
  ('boa noite', 11), ('desculpa', 12), ('1', 13), ('2', 14), ('3', 15),
  ('4', 16), ('5', 17),
  -- cumprimentos e cortesia
  ('boa tarde', 18), ('adeus', 19), ('até logo', 20), ('com licença', 21),
  ('de nada', 22), ('tudo bem', 23), ('como estás', 24), ('prazer', 25),
  -- pessoas e família
  ('nome', 26), ('eu', 27), ('amigo', 28), ('família', 29), ('mãe', 30),
  ('pai', 31), ('irmão', 32),
  -- lugares e coisas do dia a dia
  ('escola', 33), ('trabalho', 34), ('hospital', 35), ('médico', 36),
  ('dinheiro', 37), ('comprar', 38), ('quanto custa', 39), ('casa de banho', 40),
  -- necessidades e sentimentos
  ('fome', 41), ('sede', 42), ('dor', 43), ('doente', 44), ('cansado', 45),
  ('feliz', 46), ('triste', 47), ('amor', 48),
  -- verbos
  ('querer', 49), ('gostar', 50), ('precisar', 51), ('ir', 52), ('vir', 53),
  ('comer', 54), ('beber', 55), ('dormir', 56), ('falar', 57),
  -- compreensão
  ('não sei', 58), ('entendo', 59), ('não entendo', 60), ('repete', 61),
  ('devagar', 62),
  -- perguntas e tempo
  ('onde', 63), ('quando', 64), ('porquê', 65), ('quem', 66), ('hoje', 67),
  ('amanhã', 68), ('agora', 69),
  -- quantidade e qualidade
  ('muito', 70), ('pouco', 71), ('bom', 72), ('mau', 73),
  -- números
  ('6', 74), ('7', 75), ('8', 76), ('9', 77), ('10', 78),
  -- outros
  ('telefone', 79), ('polícia', 80)
on conflict (word) do nothing;
