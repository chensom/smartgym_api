/** Error de negocio del cobro a gimnasios, con el status HTTP que corresponde. */
export class CobroError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
