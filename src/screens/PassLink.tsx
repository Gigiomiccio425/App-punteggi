import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useMe } from '../app/context';
import { useAsync } from '../app/hooks';
import { sfx } from '../lib/sfx';
import { Empty, Panel, Spinner } from '../ui/kit';

/** Pass di un giocatore letto "fuori dall'app" (es. iPhone del master in lettura in background). */
export function PassLink() {
  const { token = '' } = useParams();
  const me = useMe();
  const { backend, fail, toast } = useApp();
  const navigate = useNavigate();
  const mine = useAsync(async () => {
    const id = await backend.myActiveTableId();
    if (!id) return null;
    const st = await backend.getTable(id);
    return st.table.masterId === me.id && ['lobby', 'playing'].includes(st.table.status) ? st : null;
  }, [backend, me.id]);

  if (mine.loading) return <Spinner />;
  if (!mine.data) {
    return (
      <Empty icon="🎫">
        Questo è il pass NFC di un giocatore di Party Casinò. Solo il game master di un tavolo aperto può usarlo per farlo sedere.
        <br />
        <Link to="/">Torna alla sala</Link>
      </Empty>
    );
  }
  const st = mine.data;
  return (
    <Panel title="Pass giocatore letto" tone="felt">
      <p>Vuoi far sedere questo giocatore al tavolo “{st.table.name}”?</p>
      <div className="row-end">
        <Link to={`/tavolo/${st.table.id}`} className="btn btn-ghost">
          No
        </Link>
        <button
          type="button"
          className="btn btn-gold"
          onClick={async () => {
            try {
              const p = await backend.addPlayerByPass(st.table.id, token);
              sfx.nfc();
              toast(`${p.displayName} si è seduto al tavolo`, 'success');
              navigate(`/tavolo/${st.table.id}`);
            } catch (e) {
              fail(e);
            }
          }}
        >
          Fallo sedere
        </button>
      </div>
    </Panel>
  );
}
